/**
 * What one frame is worth looking at.
 *
 * Two things need this and they want opposite verdicts. Shot grading asks "is
 * anything WRONG with this?" and penalizes faults. Picking a cover frame asks
 * "which of these is the most arresting?" and rewards punch — the frames that
 * merely have nothing wrong with them all tie at the top otherwise.
 *
 * Pure: takes a decoded gray raster, returns numbers.
 */

import { detailProfile } from "./framing.js";

export interface FrameStats {
  /** Mean luma, 0..255. */
  brightness: number;
  /** Luma standard deviation — washed-out or fogged frames sit low. */
  contrast: number;
  /** Mean gradient magnitude per pixel: how much edge detail the frame carries. */
  detail: number;
}

export function frameStats(frame: Uint8Array, width: number, height: number): FrameStats {
  if (frame.length === 0) {
    throw new Error("empty frame — nothing decoded");
  }

  let total = 0;
  for (let i = 0; i < frame.length; i++) total += frame[i];
  const brightness = total / frame.length;

  let variance = 0;
  for (let i = 0; i < frame.length; i++) {
    const d = frame[i] - brightness;
    variance += d * d;
  }

  const gradients = detailProfile(frame, width, height).columns;
  const pixels = width * height;

  return {
    brightness: Math.round(brightness * 10) / 10,
    contrast: Math.round(Math.sqrt(variance / frame.length) * 10) / 10,
    detail: Math.round((gradients.reduce((sum, v) => sum + v, 0) / pixels) * 100) / 100,
  };
}

/** The exposure a thumbnail wants: bright enough to read, short of clipping. */
const IDEAL_BRIGHTNESS_LOW = 90;
const IDEAL_BRIGHTNESS_HIGH = 180;
/** Contrast and detail at which a frame is already as punchy as it needs to be. */
const CONTRAST_TARGET = 70;
const DETAIL_TARGET = 40;

const WEIGHTS = { exposure: 0.4, contrast: 0.3, detail: 0.3 };

export interface CoverScore {
  /** 0..1, higher = a better still to lead with. */
  score: number;
  exposure: number;
  contrast: number;
  detail: number;
}

/**
 * How good a still this frame makes. A cover is seen at thumbnail size before
 * anything else, so it is scored on carrying — well exposed, high contrast,
 * plenty of edge detail — rather than on being free of faults.
 */
export function scoreCoverFrame(stats: FrameStats): CoverScore {
  // Each side falls off across the headroom it actually has, so both black and
  // blown-out white bottom out at zero — a single shared falloff distance left
  // pure white scoring better than pure black for no reason.
  const below = Math.max(0, IDEAL_BRIGHTNESS_LOW - stats.brightness) / IDEAL_BRIGHTNESS_LOW;
  const above =
    Math.max(0, stats.brightness - IDEAL_BRIGHTNESS_HIGH) / (255 - IDEAL_BRIGHTNESS_HIGH);
  const exposure = Math.max(0, 1 - Math.max(below, above));

  const contrast = Math.min(1, stats.contrast / CONTRAST_TARGET);
  const detail = Math.min(1, stats.detail / DETAIL_TARGET);

  const score =
    WEIGHTS.exposure * exposure + WEIGHTS.contrast * contrast + WEIGHTS.detail * detail;

  return {
    score: Math.round(score * 1000) / 1000,
    exposure: Math.round(exposure * 100) / 100,
    contrast: Math.round(contrast * 100) / 100,
    detail: Math.round(detail * 100) / 100,
  };
}

export interface ScoredFrame extends CoverScore {
  atSeconds: number;
  stats: FrameStats;
}

/**
 * Best frame first. Ties break toward the earlier frame: a cover is also the
 * first thing the viewer sees moving, so the opening is the safer of two
 * equals.
 */
export function rankCoverFrames(frames: ScoredFrame[]): ScoredFrame[] {
  return [...frames].sort((a, b) =>
    b.score === a.score ? a.atSeconds - b.atSeconds : b.score - a.score
  );
}
