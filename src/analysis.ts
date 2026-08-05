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

export interface ScdetSample {
  time: number;
  /** scdet's scene-change score: min(mafd, |mafd - prev_mafd|), 0..100. */
  score: number;
  /** Mean absolute frame difference, 0..100 — sustained during dissolves. */
  mafd: number;
}

/**
 * Parse per-frame scdet metadata out of ffmpeg stderr. The `metadata=print`
 * filter emits a `pts_time:` line per frame followed by one line per metadata
 * key; frames without a score (the very first one) are skipped.
 */
export function parseScdetSamples(stderr: string): ScdetSample[] {
  const samples: ScdetSample[] = [];
  let time: number | null = null;
  let mafd = 0;
  for (const line of stderr.split("\n")) {
    const timeMatch = line.match(/pts_time:([\d.]+)/);
    if (timeMatch) {
      time = Number(timeMatch[1]);
      continue;
    }
    const mafdMatch = line.match(/lavfi\.scd\.mafd=(-?[\d.]+)/);
    if (mafdMatch) {
      mafd = Number(mafdMatch[1]);
      continue;
    }
    const scoreMatch = line.match(/lavfi\.scd\.score=(-?[\d.]+)/);
    if (scoreMatch && time != null) {
      samples.push({ time, score: Number(scoreMatch[1]), mafd });
      time = null;
    }
  }
  return samples;
}

export interface SceneCut {
  time: number;
  score: number;
  /** Measured, not guessed: "cut" = single-frame spike, "fade" = a dissolve. */
  type: "cut" | "fade";
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Turn per-frame scdet scores into scene cuts:
 * - adaptive threshold (median + k*MAD, floored) instead of a fixed score,
 *   so quiet footage and busy footage both threshold sensibly;
 * - local-maximum picking plus a minimum gap, because transitions produce
 *   double detections that inflate the cut count;
 * - cut vs fade classification from the mafd profile after each detection —
 *   a hard cut's frame difference collapses immediately, a dissolve's stays
 *   near the peak for the length of the fade.
 */
export function pickSceneCuts(
  samples: ScdetSample[],
  {
    floor = 8,
    madK = 6,
    minGapSeconds = 0.15,
    fadeWindowSeconds = 0.35,
  } = {}
): SceneCut[] {
  if (samples.length === 0) return [];

  const scores = samples.map((s) => s.score);
  const med = median(scores);
  const mad = median(scores.map((s) => Math.abs(s - med)));
  const threshold = Math.max(floor, med + madK * mad);

  const candidates: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i].score;
    if (s < threshold) continue;
    const prev = i > 0 ? samples[i - 1].score : -Infinity;
    const next = i + 1 < samples.length ? samples[i + 1].score : -Infinity;
    if (s >= prev && s > next) candidates.push(i);
  }

  const deduped: number[] = [];
  for (const idx of candidates) {
    const last = deduped[deduped.length - 1];
    if (last !== undefined && samples[idx].time - samples[last].time < minGapSeconds) {
      if (samples[idx].score > samples[last].score) deduped[deduped.length - 1] = idx;
      continue;
    }
    deduped.push(idx);
  }

  return deduped.map((idx) => {
    const { time, score, mafd } = samples[idx];
    const after = samples
      .filter((s, j) => j > idx && s.time - time <= fadeWindowSeconds)
      .map((s) => s.mafd);
    const sustained = after.length ? median(after) : 0;
    const type = mafd > 0 && sustained >= mafd * 0.5 ? "fade" : "cut";
    return {
      time: Math.round(time * 100) / 100,
      score: Math.round(score * 10) / 10,
      type,
    };
  });
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
