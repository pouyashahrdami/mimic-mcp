import { describe, expect, it } from "vitest";
import { fingerprintTransition } from "./analysis.js";

const W = 96;
const H = 54;
const FPS = 30;

function patternA(x: number, y: number): number {
  return 128 + 60 * Math.sin(x * 0.29) * Math.cos(y * 0.21);
}

function patternB(x: number, y: number): number {
  return 128 + 60 * Math.sin(x * 0.13 + 2) * Math.cos(y * 0.37 + 1);
}

function frameOf(fn: (x: number, y: number) => number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      out[y * W + x] = Math.max(0, Math.min(255, Math.round(fn(x, y))));
    }
  }
  return out;
}

const A = frameOf(patternA);
const B = frameOf(patternB);

function blend(a: Uint8Array, b: Uint8Array, t: number): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.round(a[i] * (1 - t) + b[i] * t);
  return out;
}

function constant(value: number): Uint8Array {
  return new Uint8Array(W * H).fill(value);
}

/** New shot revealed left-to-right behind a sweeping vertical boundary. */
function wipeFrame(t: number): Uint8Array {
  const boundary = Math.round(t * W);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      out[y * W + x] = x < boundary ? B[y * W + x] : A[y * W + x];
    }
  }
  return out;
}

describe("fingerprintTransition", () => {
  it("classifies a hard cut with a one-frame duration", () => {
    const frames = [A, A, A, A, B, B, B, B];
    const fp = fingerprintTransition(frames, W, H, FPS)!;
    expect(fp.kind).toBe("cut");
    expect(fp.durationSeconds).toBeLessThanOrEqual(2 / FPS + 1e-9);
  });

  it("classifies a linear crossfade as a dissolve and measures its length", () => {
    const fadePairs = 9;
    const frames = [
      A, A, A,
      ...Array.from({ length: fadePairs }, (_, i) => blend(A, B, (i + 1) / (fadePairs + 1))),
      B, B, B,
    ];
    const fp = fingerprintTransition(frames, W, H, FPS)!;
    expect(fp.kind).toBe("dissolve");
    expect(fp.durationSeconds).toBeGreaterThan(4 / FPS);
    expect(fp.durationSeconds).toBeLessThan(14 / FPS);
  });

  it("classifies a dip to black", () => {
    const black = constant(0);
    const frames = [
      A, A,
      blend(A, black, 0.5), black, black, blend(black, B, 0.5),
      B, B,
    ];
    expect(fingerprintTransition(frames, W, H, FPS)!.kind).toBe("dip-to-black");
  });

  it("classifies a dip to white", () => {
    const white = constant(255);
    const frames = [
      A, A,
      blend(A, white, 0.5), white, white, blend(white, B, 0.5),
      B, B,
    ];
    expect(fingerprintTransition(frames, W, H, FPS)!.kind).toBe("dip-to-white");
  });

  it("classifies a left-to-right wipe with its direction", () => {
    const steps = 8;
    const frames = [
      A, A,
      ...Array.from({ length: steps }, (_, i) => wipeFrame((i + 1) / (steps + 1))),
      B, B,
    ];
    const fp = fingerprintTransition(frames, W, H, FPS)!;
    expect(fp.kind).toBe("wipe");
    expect(fp.direction).toBe("right");
  });

  it("returns null when there are not enough frames", () => {
    expect(fingerprintTransition([A, B], W, H, FPS)).toBeNull();
  });

  it("returns null for a completely static window", () => {
    const frames = [A, A, A, A, A];
    expect(fingerprintTransition(frames, W, H, FPS)).toBeNull();
  });

  it("refuses to classify continuous camera motion as a transition", () => {
    // A steady pan: every frame pair changes about the same amount, so there
    // is no peak towering over the baseline.
    const frames = Array.from({ length: 12 }, (_, i) =>
      frameOf((x, y) => patternA(x + i * 1.5, y))
    );
    expect(fingerprintTransition(frames, W, H, FPS)).toBeNull();
  });
});
