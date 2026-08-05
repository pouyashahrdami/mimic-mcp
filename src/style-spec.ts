import type { SceneCut, ShotMotion } from "./analysis.js";

/**
 * The measured description of a reference reel — the hub the redesign hangs
 * off. Analysis MEASURES everything here (nothing is guessed from frames by
 * the agent); the recipe is written as a projection of it, and review diffs
 * the render's spec against the reference's. Grows as analysis learns more:
 * transitions richer than cut/fade (step 2), captions + fonts (step 5).
 */
export interface StyleSpec {
  source: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  shots: SpecShot[];
  /** Every detected transition/overlay event with its measured type. */
  transitions: SceneCut[];
  beats: number[];
  bpm: number | null;
}

export interface SpecShot {
  start: number;
  end: number;
  /**
   * Measured camera/content motion inside the shot: punch-in, pan, or
   * static — with fitted easing. Null when the shot was too short to judge
   * or wasn't sampled.
   */
  motion: ShotMotion | null;
}
