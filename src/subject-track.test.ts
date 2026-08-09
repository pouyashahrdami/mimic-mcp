import { describe, expect, it } from "vitest";
import {
  buildTrack,
  fillGaps,
  limitSpeed,
  positionAt,
  smooth,
  toPositionString,
  type Keyframe,
  type TrackPoint,
} from "./subject-track.js";

/** Points on a fixed cadence, all confident unless said otherwise. */
function points(
  xs: number[],
  { each = 0.5, y = 0.5, confidence = 1 }: { each?: number; y?: number; confidence?: number } = {}
): TrackPoint[] {
  return xs.map((x, i) => ({ atSeconds: i * each, x, y, confidence }));
}

describe("fillGaps", () => {
  it("leaves a confident series alone", () => {
    const input = points([0.2, 0.4, 0.6]);
    expect(fillGaps(input)).toEqual(input);
  });

  it("holds the nearest known position through a gap", () => {
    const input: TrackPoint[] = [
      { atSeconds: 0, x: 0.2, y: 0.5, confidence: 1 },
      { atSeconds: 0.5, x: 0.9, y: 0.1, confidence: 0.05 },
      { atSeconds: 1, x: 0.25, y: 0.5, confidence: 1 },
    ];
    const filled = fillGaps(input);
    expect(filled[1].x).toBe(0.2);
    expect(filled[1].y).toBe(0.5);
  });

  it("returns nothing when no window had a subject", () => {
    expect(fillGaps(points([0.2, 0.4], { confidence: 0 }))).toEqual([]);
  });
});

describe("smooth", () => {
  it("takes the wobble out of a still subject", () => {
    const wobbly = points([0.5, 0.56, 0.44, 0.55, 0.45]);
    const smoothed = smooth(wobbly);
    const spread = Math.max(...smoothed.map((k) => k.x)) - Math.min(...smoothed.map((k) => k.x));
    expect(spread).toBeLessThan(0.1);
  });

  it("keeps following a real move rather than flattening it", () => {
    const smoothed = smooth(points([0.1, 0.2, 0.3, 0.4, 0.5]));
    expect(smoothed[0].x).toBeLessThan(smoothed[smoothed.length - 1].x);
    expect(smoothed[smoothed.length - 1].x).toBeGreaterThan(0.35);
  });

  it("keeps one point where it is", () => {
    expect(smooth(points([0.3]))).toEqual([{ atSeconds: 0, x: 0.3, y: 0.5 }]);
  });
});

describe("limitSpeed", () => {
  it("lets a believable move through untouched", () => {
    const keys: Keyframe[] = [
      { atSeconds: 0, x: 0.3, y: 0.5 },
      { atSeconds: 1, x: 0.5, y: 0.5 },
    ];
    expect(limitSpeed(keys)).toEqual(keys);
  });

  it("clamps a jump the subject could not have made", () => {
    const keys: Keyframe[] = [
      { atSeconds: 0, x: 0.1, y: 0.5 },
      { atSeconds: 0.2, x: 0.9, y: 0.5 },
    ];
    const limited = limitSpeed(keys);
    expect(limited[1].x).toBeLessThan(0.3);
    expect(limited[1].x).toBeGreaterThan(0.1);
  });

  it("clamps toward the jump, not away from it", () => {
    const back: Keyframe[] = [
      { atSeconds: 0, x: 0.9, y: 0.5 },
      { atSeconds: 0.2, x: 0.1, y: 0.5 },
    ];
    expect(limitSpeed(back)[1].x).toBeLessThan(0.9);
  });

  it("handles an empty track", () => {
    expect(limitSpeed([])).toEqual([]);
  });
});

describe("buildTrack", () => {
  it("reports a still subject as a position to hold, not a track", () => {
    const result = buildTrack(points([0.3, 0.31, 0.29, 0.3, 0.305]));
    expect(result.track).toBeNull();
    expect(result.staticPosition?.x).toBeCloseTo(0.3, 1);
    expect(result.reason).toMatch(/only jitters/);
  });

  it("tracks a subject that crosses the frame", () => {
    const result = buildTrack(points([0.2, 0.3, 0.4, 0.5, 0.6], { each: 1 }));
    expect(result.track).not.toBeNull();
    expect(result.travelX).toBeGreaterThan(0.06);
    expect(result.track?.[0].x).toBeLessThan(result.track?.[result.track.length - 1].x ?? 0);
  });

  it("tracks vertical movement too", () => {
    const vertical: TrackPoint[] = [0.2, 0.35, 0.5, 0.65, 0.8].map((y, i) => ({
      atSeconds: i,
      x: 0.5,
      y,
      confidence: 1,
    }));
    const result = buildTrack(vertical);
    expect(result.track).not.toBeNull();
    expect(result.travelY).toBeGreaterThan(0.06);
  });

  it("refuses to aim at anything when no window found a subject", () => {
    const result = buildTrack(points([0.2, 0.8], { confidence: 0.1 }));
    expect(result.track).toBeNull();
    expect(result.staticPosition).toBeNull();
    expect(result.reason).toMatch(/leave the crop centred/);
  });

  it("does not turn a measurement glitch into a whip pan", () => {
    // One window jumps to the far side and comes straight back.
    const glitchy = points([0.3, 0.3, 0.95, 0.3, 0.3], { each: 0.5 });
    const result = buildTrack(glitchy);
    const xs = result.track?.map((k) => k.x) ?? [result.staticPosition?.x ?? 0.5];
    expect(Math.max(...xs)).toBeLessThan(0.6);
  });

  it("handles a single measurement", () => {
    const result = buildTrack(points([0.4]));
    expect(result.track).toBeNull();
    expect(result.staticPosition).toEqual({ x: 0.4, y: 0.5 });
  });
});

describe("positionAt", () => {
  const track: Keyframe[] = [
    { atSeconds: 0, x: 0.2, y: 0.4 },
    { atSeconds: 1, x: 0.4, y: 0.6 },
    { atSeconds: 2, x: 0.8, y: 0.6 },
  ];

  it("returns a keyframe exactly at its own time", () => {
    expect(positionAt(track, 1)).toEqual({ x: 0.4, y: 0.6 });
  });

  it("interpolates between keyframes", () => {
    expect(positionAt(track, 0.5).x).toBeCloseTo(0.3, 5);
    expect(positionAt(track, 0.5).y).toBeCloseTo(0.5, 5);
    expect(positionAt(track, 1.5).x).toBeCloseTo(0.6, 5);
  });

  it("holds the ends rather than extrapolating past them", () => {
    expect(positionAt(track, -5)).toEqual({ x: 0.2, y: 0.4 });
    expect(positionAt(track, 99)).toEqual({ x: 0.8, y: 0.6 });
  });

  it("centres when there is no track at all", () => {
    expect(positionAt([], 1)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("toPositionString", () => {
  it("writes the CSS objectPosition the recipe uses", () => {
    expect(toPositionString({ x: 0.25, y: 0.75 })).toBe("25% 75%");
  });
});
