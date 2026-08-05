import type { ShotMotion, TransitionKind } from "./analysis.js";

export interface MeasuredTransition {
  time: number;
  /** Fingerprinted from the full-fps frames around the event, not guessed. */
  kind: TransitionKind;
  durationSeconds: number;
  /** For wipes: which way the new shot sweeps in. */
  direction?: "left" | "right" | "up" | "down";
}

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
  /** Every shot-to-shot transition with its fingerprinted kind and duration. */
  transitions: MeasuredTransition[];
  /** On-screen graphic swaps on held shots (stats cards cycling, etc.). */
  overlayChanges: number[];
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
