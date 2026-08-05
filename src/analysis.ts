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
