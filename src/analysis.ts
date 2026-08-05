/**
 * Pure math for reference-video analysis. Everything ffmpeg-free lives here so
 * it can be unit-tested without media files.
 */

export interface Shot {
  start: number;
  end: number;
}

/** Turn cut timestamps into contiguous [start, end) shot ranges. */
export function shotsFromCuts(cuts: number[], durationSeconds: number): Shot[] {
  const starts = [0, ...cuts];
  const ends = [...cuts, durationSeconds];
  return starts
    .map((start, i) => ({ start, end: ends[i] }))
    .filter((s) => s.end - s.start > 0.01);
}

export interface FrameChangeSample {
  time: number;
  /** Mean absolute per-pixel change vs the previous frame, 0..100. */
  diff: number;
  /** Fraction of the frame's grid cells that changed meaningfully, 0..1. */
  area: number;
}

/**
 * Diff every consecutive pair of downscaled grayscale frames. Each frame is a
 * tiny pixel vector; the distance between neighbors is the change signal, and
 * a coarse cell grid records WHERE the change happened — a scene cut moves
 * (nearly) every cell, an on-screen graphic swap moves only its own region.
 * Working on every frame means nothing is missed between samples, and unlike
 * scdet's min(diff, delta-diff) score, a swap animated across a few frames
 * still shows up at full strength.
 */
export function frameChangeSamples(
  frames: Uint8Array[],
  width: number,
  height: number,
  fps: number,
  { cols = 12, rows = 9, cellChangeThreshold = 6 } = {}
): FrameChangeSample[] {
  const samples: FrameChangeSample[] = [];
  const cellW = width / cols;
  const cellH = height / rows;

  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    let total = 0;
    const cellSums = new Float64Array(cols * rows);
    const cellCounts = new Float64Array(cols * rows);
    for (let y = 0; y < height; y++) {
      const cellRow = Math.min(rows - 1, Math.floor(y / cellH));
      for (let x = 0; x < width; x++) {
        const d = Math.abs(a[y * width + x] - b[y * width + x]);
        total += d;
        const cell = cellRow * cols + Math.min(cols - 1, Math.floor(x / cellW));
        cellSums[cell] += d;
        cellCounts[cell] += 1;
      }
    }
    let changedCells = 0;
    for (let c = 0; c < cellSums.length; c++) {
      if (cellSums[c] / cellCounts[c] / 2.55 >= cellChangeThreshold) changedCells++;
    }
    samples.push({
      time: i / fps,
      diff: total / (width * height) / 2.55,
      area: changedCells / (cols * rows),
    });
  }
  return samples;
}

export interface SceneCut {
  time: number;
  score: number;
  /** Fraction of the frame that changed, 0..1 — the basis for `type`. */
  area: number;
  /**
   * Measured, not guessed: "cut" = the whole frame changed at once, "fade" =
   * the whole frame changed gradually (dissolve), "overlay" = only a region
   * changed — an on-screen card/graphic swapping while the camera holds.
   */
  type: "cut" | "fade" | "overlay";
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Turn per-frame change samples into scene cuts:
 * - adaptive threshold (median + k*MAD, floored) instead of a fixed score,
 *   so quiet footage and busy footage both threshold sensibly;
 * - local-maximum picking plus a minimum gap, because transitions produce
 *   double detections that inflate the cut count;
 * - classification is geometric: the changed AREA says what kind of event it
 *   was. A localized change is an "overlay" (graphic swapping on a held
 *   shot) regardless of how bright the spike was; a full-frame change is a
 *   "cut" when the diff collapses immediately after and a "fade" when it
 *   stays near the peak for the length of a dissolve.
 */
export function pickSceneCuts(
  samples: FrameChangeSample[],
  {
    floor = 1.5,
    madK = 6,
    minGapSeconds = 0.15,
    fadeWindowSeconds = 0.35,
    overlayMaxArea = 0.5,
    maxOverlayNeighbors = 6,
  } = {}
): SceneCut[] {
  if (samples.length === 0) return [];

  const diffs = samples.map((s) => s.diff);
  const med = median(diffs);
  const mad = median(diffs.map((d) => Math.abs(d - med)));
  const threshold = Math.max(floor, med + madK * mad);

  const candidates: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const d = samples[i].diff;
    if (d < threshold) continue;
    const prev = i > 0 ? samples[i - 1].diff : -Infinity;
    const next = i + 1 < samples.length ? samples[i + 1].diff : -Infinity;
    if (d >= prev && d > next) candidates.push(i);
  }

  const deduped: number[] = [];
  for (const idx of candidates) {
    const last = deduped[deduped.length - 1];
    if (last !== undefined && samples[idx].time - samples[last].time < minGapSeconds) {
      if (samples[idx].diff > samples[last].diff) deduped[deduped.length - 1] = idx;
      continue;
    }
    // A dissolve's plateau can carry several local maxima farther apart than
    // the dedupe gap; if every frame between two detections stays elevated,
    // they are one transition, not two.
    if (last !== undefined) {
      const bridge = Math.min(samples[idx].diff, samples[last].diff) * 0.5;
      let bridged = true;
      for (let j = last + 1; j < idx; j++) {
        if (samples[j].diff < bridge) {
          bridged = false;
          break;
        }
      }
      if (bridged) {
        if (samples[idx].diff > samples[last].diff) deduped[deduped.length - 1] = idx;
        continue;
      }
    }
    deduped.push(idx);
  }

  const cuts: SceneCut[] = [];
  for (const idx of deduped) {
    const { time, diff, area } = samples[idx];
    // Frames around the peak that carry comparable change. A hard cut has
    // none; a dissolve has a short run; continuous subject motion keeps the
    // whole window elevated.
    const elevated = samples.filter(
      (s, j) =>
        j !== idx &&
        Math.abs(s.time - time) <= fadeWindowSeconds &&
        s.diff >= diff * 0.5
    ).length;
    let type: SceneCut["type"];
    if (area < overlayMaxArea) {
      // A localized change is only an overlay when it is temporally isolated
      // — a spike between quiet frames. A peak riding on continuously
      // elevated frames is subject motion, not a graphic swapping.
      if (elevated > maxOverlayNeighbors) continue;
      type = "overlay";
    } else {
      type = elevated >= 3 ? "fade" : "cut";
    }
    cuts.push({
      time: Math.round(time * 100) / 100,
      score: Math.round(diff * 10) / 10,
      area: Math.round(area * 100) / 100,
      type,
    });
  }
  return cuts;
}

/**
 * Estimate tempo by autocorrelating the onset train instead of taking the
 * median inter-onset gap — the median breaks as soon as half the onsets are
 * off-beat hits (speech plosives, syncopation), while autocorrelation still
 * peaks at the true period. Onsets are smeared a few samples wide so ±20ms of
 * timing jitter still counts as a match, and each candidate period gets a
 * bonus for its double correlating too, which keeps harmonics from winning.
 */
export function estimateBpm(
  onsets: number[],
  { sampleRate = 100, minBpm = 50, maxBpm = 200 } = {}
): number | null {
  if (onsets.length < 4) return null;
  const first = onsets[0];
  const duration = onsets[onsets.length - 1] - first;
  if (duration <= 0) return null;

  const n = Math.ceil(duration * sampleRate) + 3;
  const train = new Float64Array(n);
  for (const t of onsets) {
    const center = Math.round((t - first) * sampleRate);
    for (let d = -2; d <= 2; d++) {
      const i = center + d;
      if (i >= 0 && i < n) train[i] += 1 - Math.abs(d) / 3;
    }
  }

  const autocorr = (lag: number): number => {
    let r = 0;
    for (let k = 0; k + lag < n; k++) r += train[k] * train[k + lag];
    return r;
  };

  const minLag = Math.max(1, Math.round((sampleRate * 60) / maxBpm));
  const maxLag = Math.min(n - 1, Math.round((sampleRate * 60) / minBpm));
  let bestLag = 0;
  let bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const score = autocorr(lag) + 0.5 * (2 * lag < n ? autocorr(2 * lag) : 0);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  // A real grid produces several aligned pairs; near-zero means no periodicity.
  if (bestLag === 0 || bestScore < 2) return null;
  return Math.round((60 * sampleRate) / bestLag);
}

export type FramePosition = "start" | "mid" | "end";

export interface PlannedFrame {
  shotIndex: number;
  position: FramePosition;
  atSeconds: number;
}

// Shots shorter than this get a single mid frame — start/mid/end of a flash
// cut are visually identical and just pad the frame count.
const SHORT_SHOT_SECONDS = 0.5;

/**
 * Plan which frames to extract: start/mid/end per shot, so motion inside a
 * shot (punch-in zoom, pans) shows up as differences between its frames.
 * Frames are inset from the shot boundaries because the boundary frames are
 * often mid-transition. When there are more shots than `maxShots`, an evenly
 * spaced subset keeps the total frame count reviewable.
 */
export function planShotFrames(shots: Shot[], maxShots = 8): PlannedFrame[] {
  let indices = shots.map((_, i) => i);
  if (indices.length > maxShots) {
    const step = indices.length / maxShots;
    indices = Array.from({ length: maxShots }, (_, i) => Math.floor(i * step));
  }

  const frames: PlannedFrame[] = [];
  for (const shotIndex of indices) {
    const { start, end } = shots[shotIndex];
    const length = end - start;
    const mid = start + length / 2;
    if (length < SHORT_SHOT_SECONDS) {
      frames.push({ shotIndex, position: "mid", atSeconds: mid });
      continue;
    }
    const inset = Math.min(0.15, length / 4);
    frames.push(
      { shotIndex, position: "start", atSeconds: start + inset },
      { shotIndex, position: "mid", atSeconds: mid },
      { shotIndex, position: "end", atSeconds: end - inset }
    );
  }
  return frames;
}
