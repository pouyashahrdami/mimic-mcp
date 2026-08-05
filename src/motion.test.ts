import { describe, expect, it } from "vitest";
import {
  accumulateMotion,
  estimateFrameMotion,
  fitEasing,
  summarizeShotMotion,
} from "./analysis.js";

const W = 96;
const H = 54;

/** Smooth analytic test pattern with texture everywhere, sampled anywhere. */
function pattern(x: number, y: number): number {
  return (
    128 +
    55 * Math.sin(x * 0.31) * Math.cos(y * 0.23) +
    40 * Math.sin(x * 0.11 + y * 0.17)
  );
}

/**
 * Render a frame whose content has been translated by (dx, dy) and scaled by
 * `scale` about the frame center relative to the base pattern. Content at
 * output pixel x came from the pattern at the inverse-transformed position.
 */
function renderFrame(dx: number, dy: number, scale: number): Uint8Array {
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = cx + (x - cx - dx) / scale;
      const sy = cy + (y - cy - dy) / scale;
      out[y * W + x] = Math.max(0, Math.min(255, Math.round(pattern(sx, sy))));
    }
  }
  return out;
}

describe("estimateFrameMotion", () => {
  it("recovers a small translation", () => {
    const a = renderFrame(0, 0, 1);
    const b = renderFrame(0.6, -0.4, 1);
    const m = estimateFrameMotion(a, b, W, H);
    expect(m.dx).toBeCloseTo(0.6, 0);
    expect(m.dy).toBeCloseTo(-0.4, 0);
    expect(m.scale).toBeCloseTo(1, 1);
  });

  it("recovers a small zoom-in as scale > 1", () => {
    const a = renderFrame(0, 0, 1);
    const b = renderFrame(0, 0, 1.012);
    const m = estimateFrameMotion(a, b, W, H);
    expect(m.scale).toBeGreaterThan(1.004);
    expect(m.scale).toBeLessThan(1.02);
    expect(Math.abs(m.dx)).toBeLessThan(0.3);
  });

  it("recovers a zoom-out as scale < 1", () => {
    const a = renderFrame(0, 0, 1.012);
    const b = renderFrame(0, 0, 1);
    const m = estimateFrameMotion(a, b, W, H);
    expect(m.scale).toBeLessThan(0.998);
  });

  it("reports no motion for identical frames", () => {
    const a = renderFrame(0, 0, 1);
    const m = estimateFrameMotion(a, a, W, H);
    expect(m.dx).toBeCloseTo(0, 3);
    expect(m.dy).toBeCloseTo(0, 3);
    expect(m.scale).toBeCloseTo(1, 3);
  });

  it("returns zero motion for a featureless frame instead of blowing up", () => {
    const flat = new Uint8Array(W * H).fill(128);
    const m = estimateFrameMotion(flat, flat, W, H);
    expect(m).toEqual({ dx: 0, dy: 0, scale: 1 });
  });
});

describe("accumulateMotion + summarizeShotMotion", () => {
  it("integrates a slow linear punch-in into a zoom summary", () => {
    // 30 frames zooming 1.0 -> ~1.09 in even per-frame steps.
    const frames = Array.from({ length: 30 }, (_, i) =>
      renderFrame(0, 0, 1 + i * 0.003)
    );
    const samples = accumulateMotion(frames, W, H, 30);
    const motion = summarizeShotMotion(samples, W, H)!;
    expect(motion.type).toBe("zoom");
    expect(motion.scaleTo).toBeGreaterThan(1.05);
    expect(motion.scaleTo).toBeLessThan(1.13);
    expect(motion.easing).toBe("linear");
  });

  it("integrates an eased punch-in and identifies the easing", () => {
    const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
    const frames = Array.from({ length: 30 }, (_, i) =>
      renderFrame(0, 0, 1 + 0.09 * easeOut(i / 29))
    );
    const samples = accumulateMotion(frames, W, H, 30);
    const motion = summarizeShotMotion(samples, W, H)!;
    expect(motion.type).toBe("zoom");
    expect(motion.easing).toBe("easeOut");
  });

  it("integrates a pan into a pan summary with direction", () => {
    // Content drifting right by 6 px over the shot (> 5% of 96 px width).
    const frames = Array.from({ length: 30 }, (_, i) =>
      renderFrame((i * 6) / 29, 0, 1)
    );
    const samples = accumulateMotion(frames, W, H, 30);
    const motion = summarizeShotMotion(samples, W, H)!;
    expect(motion.type).toBe("pan");
    expect(motion.panX).toBeGreaterThan(0.05);
    expect(Math.abs(motion.panY)).toBeLessThan(0.02);
  });

  it("calls a static shot static", () => {
    const frames = Array.from({ length: 20 }, () => renderFrame(0, 0, 1));
    const samples = accumulateMotion(frames, W, H, 30);
    const motion = summarizeShotMotion(samples, W, H)!;
    expect(motion.type).toBe("static");
    expect(motion.easing).toBeNull();
  });

  it("returns null when there are too few frames to judge", () => {
    const frames = [renderFrame(0, 0, 1), renderFrame(0, 0, 1)];
    const samples = accumulateMotion(frames, W, H, 30);
    expect(summarizeShotMotion(samples, W, H)).toBeNull();
  });
});

describe("fitEasing", () => {
  it("identifies each canonical curve", () => {
    const sample = (fn: (t: number) => number) =>
      Array.from({ length: 20 }, (_, i) => fn(i / 19));
    expect(fitEasing(sample((t) => t))!.easing).toBe("linear");
    expect(fitEasing(sample((t) => t * t))!.easing).toBe("easeIn");
    expect(fitEasing(sample((t) => 1 - (1 - t) * (1 - t)))!.easing).toBe("easeOut");
  });

  it("returns null for too-short input", () => {
    expect(fitEasing([0, 1])).toBeNull();
  });
});
