/**
 * Rank the shots in a footage dump, and pick which one goes in which segment.
 *
 * The reference side of this project is measured to death; the user's own
 * footage arrives as "here's a folder, good luck". That asymmetry means the
 * agent has to be handed exactly the right clip, already trimmed. This scores
 * every shot on what a shot can be bad at — exposure, flatness, lost detail,
 * shake — and then assigns shots to the segment durations a recipe needs.
 *
 * Pure — takes decoded gray rasters and numbers, returns numbers.
 */

import { estimateFrameMotion } from "./analysis.js";
import { frameStats, type FrameStats } from "./frame-quality.js";

/** A shot's middle frame, plus what only a sequence of frames can tell you. */
export interface ShotSignals extends FrameStats {
  /** Mean absolute inter-frame change per pixel — is anything moving? */
  motion: number;
  /** 0..1 roughness of that motion frame to frame. A pan is smooth; a hand isn't. */
  jitter: number;
}

export type ShotFlaw = "dark" | "blown" | "flat" | "soft" | "shaky";

export type MotionKind = "locked" | "moving" | "shaky";

export interface ShotQuality {
  /** 0..1, where 1 is a shot with nothing measurably wrong with it. */
  score: number;
  flaws: ShotFlaw[];
  motionKind: MotionKind;
}

// Exposure bounds. Reel footage is graded bright, so the dark gate is the one
// that fires in practice — phone video shot indoors at night.
const DARK_BELOW = 45;
const BLOWN_ABOVE = 215;
/** Below this luma spread the shot is fog: a wall, a blown sky, a dead gradient. */
const FLAT_BELOW = 18;
/**
 * Below this mean gradient the shot has lost its edges. Measured on the
 * analysis raster, so this catches badly soft footage (out of focus, heavy
 * motion blur, upscaled mush) — not a mild focus miss, which downscaling hides.
 */
const SOFT_BELOW = 6;
/** Mean per-pixel change below this reads as a locked-off shot. */
const MOTION_FLOOR = 1.2;
/** Above this roughness the movement is shake rather than a camera move. */
const SHAKY_ABOVE = 0.55;

const PENALTIES: Record<ShotFlaw, number> = {
  dark: 0.35,
  blown: 0.35,
  flat: 0.2,
  soft: 0.25,
  shaky: 0.3,
};

/** Below this a shot is worth flagging rather than dropping into a reel. */
export const USABLE_SCORE = 0.5;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Mean absolute change per pixel for each consecutive frame pair. */
function motionSeries(frames: Uint8Array[], pixels: number): number[] {
  const series: number[] = [];
  for (let f = 1; f < frames.length; f++) {
    const prev = frames[f - 1];
    const curr = frames[f];
    let total = 0;
    for (let i = 0; i < pixels; i++) total += Math.abs(curr[i] - prev[i]);
    series.push(total / pixels);
  }
  return series;
}

/**
 * How rough the camera move is, 0..1: how far the frame actually travelled
 * against how far it moved to get there. A pan pushes one way, so the two match
 * and this reads 0; shake cancels itself out, so the net stays near zero while
 * the distance piles up and this reads 1.
 *
 * It has to be measured on the displacement VECTORS, not on how much the pixels
 * changed — a wobble of constant amplitude changes a constant number of pixels
 * per frame, and is indistinguishable from a steady pan until you look at which
 * way it went.
 */
function pathRoughness(frames: Uint8Array[], width: number, height: number): number {
  let netX = 0;
  let netY = 0;
  let travelled = 0;

  for (let f = 1; f < frames.length; f++) {
    const { dx, dy } = estimateFrameMotion(frames[f - 1], frames[f], width, height);
    netX += dx;
    netY += dy;
    travelled += Math.hypot(dx, dy);
  }

  if (travelled <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - Math.hypot(netX, netY) / travelled));
}

export function measureShotSignals(
  frames: Uint8Array[],
  width: number,
  height: number
): ShotSignals {
  if (frames.length === 0) {
    throw new Error("no frames decoded — the shot range is empty or unreadable");
  }

  const middle = frames[Math.floor(frames.length / 2)];
  const stats = frameStats(middle, width, height);
  const series = motionSeries(frames, width * height);

  return {
    ...stats,
    motion: Math.round(mean(series) * 100) / 100,
    jitter: Math.round(pathRoughness(frames, width, height) * 100) / 100,
  };
}

export function gradeShot(signals: ShotSignals): ShotQuality {
  const flaws: ShotFlaw[] = [];
  if (signals.brightness < DARK_BELOW) flaws.push("dark");
  if (signals.brightness > BLOWN_ABOVE) flaws.push("blown");
  if (signals.contrast < FLAT_BELOW) flaws.push("flat");
  if (signals.detail < SOFT_BELOW) flaws.push("soft");

  const moving = signals.motion >= MOTION_FLOOR;
  const shaky = moving && signals.jitter > SHAKY_ABOVE;
  if (shaky) flaws.push("shaky");

  const penalty = flaws.reduce((sum, flaw) => sum + PENALTIES[flaw], 0);

  return {
    score: Math.round(Math.max(0, 1 - penalty) * 100) / 100,
    flaws,
    motionKind: shaky ? "shaky" : moving ? "moving" : "locked",
  };
}

export interface IndexedShot {
  /** Stable handle the agent quotes back when picking, e.g. "b-roll-2#3". */
  id: string;
  clip: string;
  start: number;
  end: number;
  seconds: number;
  signals: ShotSignals;
  quality: ShotQuality;
}

export interface ShotNeed {
  /** How long the segment needs its background to run. */
  durationSeconds: number;
  /** Bias the pick toward this kind of shot when any qualify. */
  prefer?: MotionKind;
}

export interface ShotAssignment {
  /** Index into the needs array this fills. */
  need: number;
  shotId: string | null;
  /** 0 when the shot covers the need; otherwise how far short it falls. */
  shortBySeconds: number;
  reason: string;
}

/**
 * Spending a 30s hero shot on a 1s cutaway is how a footage dump runs dry
 * halfway through a reel, so leftover length costs a little score — enough to
 * break a near-tie, not enough to prefer a bad shot that happens to fit.
 */
const WASTE_WEIGHT = 0.15;

function fitness(shot: IndexedShot, need: number): number {
  const waste = Math.max(0, shot.seconds - need);
  return shot.quality.score - WASTE_WEIGHT * Math.min(1, waste / Math.max(need, 1));
}

/**
 * Assign shots to segment durations, one shot per segment, best-scoring first.
 * The hardest needs are filled first — a long segment has the fewest candidates,
 * so letting a short one take a long shot strands it.
 */
export function assignShots(shots: IndexedShot[], needs: ShotNeed[]): ShotAssignment[] {
  const available = new Set(shots.map((s) => s.id));
  const byId = new Map(shots.map((s) => [s.id, s]));
  const assignments: ShotAssignment[] = [];

  const order = needs
    .map((need, index) => ({ need, index }))
    .sort((a, b) => b.need.durationSeconds - a.need.durationSeconds);

  for (const { need, index } of order) {
    const pool = [...available].map((id) => byId.get(id) as IndexedShot);
    if (pool.length === 0) {
      assignments.push({
        need: index,
        shotId: null,
        shortBySeconds: need.durationSeconds,
        reason: "no shots left — the footage has fewer usable shots than the reel has segments",
      });
      continue;
    }

    const longEnough = pool.filter((s) => s.seconds >= need.durationSeconds);
    const preferred =
      need.prefer && longEnough.some((s) => s.quality.motionKind === need.prefer)
        ? longEnough.filter((s) => s.quality.motionKind === need.prefer)
        : longEnough;

    if (preferred.length > 0) {
      const best = preferred.reduce((a, b) =>
        fitness(b, need.durationSeconds) > fitness(a, need.durationSeconds) ? b : a
      );
      available.delete(best.id);
      assignments.push({
        need: index,
        shotId: best.id,
        shortBySeconds: 0,
        reason:
          `${best.quality.motionKind} shot, quality ${best.quality.score}` +
          (best.quality.flaws.length > 0 ? ` (${best.quality.flaws.join(", ")})` : ""),
      });
      continue;
    }

    // Nothing covers the need. The longest shot leaves the smallest hole for
    // the agent to fill — by shortening the segment, or holding a still.
    const longest = pool.reduce((a, b) => (b.seconds > a.seconds ? b : a));
    available.delete(longest.id);
    assignments.push({
      need: index,
      shotId: longest.id,
      shortBySeconds: Math.round((need.durationSeconds - longest.seconds) * 100) / 100,
      reason:
        `no shot runs ${need.durationSeconds}s — this is the longest left at ${longest.seconds}s. ` +
        "Shorten the segment, slow the clip, or hold on a still.",
    });
  }

  return assignments.sort((a, b) => a.need - b.need);
}
