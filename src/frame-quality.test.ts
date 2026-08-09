import { describe, expect, it } from "vitest";
import {
  frameStats,
  rankCoverFrames,
  scoreCoverFrame,
  type ScoredFrame,
} from "./frame-quality.js";

const W = 32;
const H = 32;

function flat(value: number): Uint8Array {
  return new Uint8Array(W * H).fill(value);
}

/** Half dark, half bright — real contrast with a hard edge down the middle. */
function split(dark: number, bright: number): Uint8Array {
  const frame = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) frame[y * W + x] = x < W / 2 ? dark : bright;
  }
  return frame;
}

describe("frameStats", () => {
  it("throws on an empty frame rather than reporting zeros", () => {
    expect(() => frameStats(new Uint8Array(0), W, H)).toThrow(/empty frame/);
  });

  it("reads a flat frame as its own value with no contrast or detail", () => {
    const stats = frameStats(flat(120), W, H);
    expect(stats.brightness).toBe(120);
    expect(stats.contrast).toBe(0);
    expect(stats.detail).toBe(0);
  });

  it("measures contrast and detail on a split frame", () => {
    const stats = frameStats(split(0, 255), W, H);
    expect(stats.brightness).toBeCloseTo(127.5, 0);
    expect(stats.contrast).toBeGreaterThan(100);
    expect(stats.detail).toBeGreaterThan(0);
  });
});

describe("scoreCoverFrame", () => {
  it("scores a flat mid-gray frame on exposure alone", () => {
    const score = scoreCoverFrame(frameStats(flat(130), W, H));
    expect(score.exposure).toBe(1);
    expect(score.contrast).toBe(0);
    expect(score.detail).toBe(0);
    expect(score.score).toBeCloseTo(0.4, 2);
  });

  it("rewards a punchy frame over a flat one at the same exposure", () => {
    const flatScore = scoreCoverFrame(frameStats(flat(128), W, H));
    const punchy = scoreCoverFrame(frameStats(split(0, 255), W, H));
    expect(punchy.score).toBeGreaterThan(flatScore.score);
  });

  it("penalizes a frame that is too dark or blown out", () => {
    expect(scoreCoverFrame(frameStats(flat(10), W, H)).exposure).toBeLessThan(0.2);
    expect(scoreCoverFrame(frameStats(flat(250), W, H)).exposure).toBeLessThan(0.3);
  });

  it("scores nothing below zero even at the extremes", () => {
    expect(scoreCoverFrame({ brightness: 0, contrast: 0, detail: 0 }).score).toBe(0);
    expect(scoreCoverFrame({ brightness: 255, contrast: 0, detail: 0 }).exposure).toBe(0);
  });

  it("does not keep rewarding contrast and detail past the point of enough", () => {
    const enough = scoreCoverFrame({ brightness: 128, contrast: 70, detail: 40 });
    const absurd = scoreCoverFrame({ brightness: 128, contrast: 700, detail: 400 });
    expect(absurd.score).toBe(enough.score);
    expect(enough.score).toBe(1);
  });
});

function scored(atSeconds: number, score: number): ScoredFrame {
  return {
    atSeconds,
    score,
    exposure: 1,
    contrast: 1,
    detail: 1,
    stats: { brightness: 128, contrast: 70, detail: 40 },
  };
}

describe("rankCoverFrames", () => {
  it("puts the strongest frame first", () => {
    const ranked = rankCoverFrames([scored(1, 0.4), scored(2, 0.9), scored(3, 0.6)]);
    expect(ranked.map((f) => f.atSeconds)).toEqual([2, 3, 1]);
  });

  it("breaks a tie toward the earlier frame", () => {
    const ranked = rankCoverFrames([scored(5, 0.8), scored(2, 0.8)]);
    expect(ranked[0].atSeconds).toBe(2);
  });

  it("leaves the input alone", () => {
    const input = [scored(5, 0.1), scored(1, 0.9)];
    rankCoverFrames(input);
    expect(input.map((f) => f.atSeconds)).toEqual([5, 1]);
  });
});
