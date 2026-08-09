import { describe, expect, it } from "vitest";
import {
  detailProfile,
  motionProfile,
  profileCentroid,
  suggestFraming,
  toBackgroundPosition,
  MIN_USABLE_CONFIDENCE,
} from "./framing.js";

const W = 32;
const H = 32;

/** A frame of `bg`, with a `value` box drawn at the given normalized centre. */
function frameWithBox(
  cx: number,
  cy: number,
  { size = 6, value = 255, bg = 0 } = {}
): Uint8Array {
  const frame = new Uint8Array(W * H).fill(bg);
  const x0 = Math.round(cx * W - size / 2);
  const y0 = Math.round(cy * H - size / 2);
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      if (x >= 0 && x < W && y >= 0 && y < H) frame[y * W + x] = value;
    }
  }
  return frame;
}

describe("profileCentroid", () => {
  it("returns the middle with no signal at all", () => {
    expect(profileCentroid(new Array(10).fill(5))).toEqual({ center: 0.5, concentration: 0 });
    expect(profileCentroid([])).toEqual({ center: 0.5, concentration: 0 });
  });

  it("finds a peak on the left", () => {
    const values = new Array(20).fill(0);
    values[3] = 100;
    values[4] = 100;
    const { center, concentration } = profileCentroid(values);
    expect(center).toBeCloseTo(0.2, 1);
    expect(concentration).toBe(1);
  });

  it("is not dragged to the middle by a raised background floor", () => {
    const flat = new Array(20).fill(50);
    flat[16] = 200;
    expect(profileCentroid(flat).center).toBeCloseTo(0.825, 2);
  });

  it("reports low concentration for energy spread across the frame", () => {
    const values = new Array(20).fill(0);
    values[1] = 100;
    values[18] = 100;
    const { concentration } = profileCentroid(values);
    expect(concentration).toBeLessThan(MIN_USABLE_CONFIDENCE);
  });
});

describe("motionProfile", () => {
  it("puts the energy where the pixels changed", () => {
    const frames = [frameWithBox(0.25, 0.5), frameWithBox(0.25, 0.5, { value: 0 })];
    const { columns } = motionProfile(frames, W, H);
    expect(profileCentroid(columns).center).toBeCloseTo(0.25, 1);
  });

  it("is flat when nothing moves", () => {
    const still = frameWithBox(0.25, 0.5);
    const { columns } = motionProfile([still, still, still], W, H);
    expect(columns.every((v) => v === 0)).toBe(true);
  });
});

describe("detailProfile", () => {
  it("puts the energy on the edges of a static subject", () => {
    const { columns, rows } = detailProfile(frameWithBox(0.75, 0.25), W, H);
    expect(profileCentroid(columns).center).toBeCloseTo(0.75, 1);
    expect(profileCentroid(rows).center).toBeCloseTo(0.25, 1);
  });
});

describe("suggestFraming", () => {
  it("tracks a moving subject in the left third", () => {
    const frames = [
      frameWithBox(0.2, 0.6),
      frameWithBox(0.2, 0.6, { value: 40 }),
      frameWithBox(0.2, 0.6),
    ];
    const framing = suggestFraming(frames, W, H);
    expect(framing.basis).toBe("motion");
    expect(framing.focusX).toBeCloseTo(0.2, 1);
    expect(framing.focusY).toBeCloseTo(0.6, 1);
    expect(framing.confidence).toBeGreaterThan(MIN_USABLE_CONFIDENCE);
  });

  it("falls back to detail when the shot is locked off", () => {
    const still = frameWithBox(0.8, 0.3);
    const framing = suggestFraming([still, still, still], W, H);
    expect(framing.basis).toBe("detail");
    expect(framing.focusX).toBeCloseTo(0.8, 1);
    expect(framing.focusY).toBeCloseTo(0.3, 1);
  });

  it("fails loud with nothing to measure", () => {
    expect(() => suggestFraming([], W, H)).toThrow(/no frames/);
  });
});

describe("toBackgroundPosition", () => {
  it("formats a confident framing as CSS object-position", () => {
    expect(
      toBackgroundPosition({ focusX: 0.25, focusY: 0.4, confidence: 0.9, basis: "motion" })
    ).toBe("25% 40%");
  });

  it("withholds a guess rather than aiming the crop at noise", () => {
    expect(
      toBackgroundPosition({ focusX: 0.5, focusY: 0.5, confidence: 0.1, basis: "motion" })
    ).toBeNull();
  });
});
