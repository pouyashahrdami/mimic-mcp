import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  frameChangeSamples,
  pickSceneCuts,
  type FrameChangeSample,
} from "./analysis.js";
import { detectSceneCuts } from "./ffmpeg.js";
import { makeCutVideo, makeFadeVideo, makeOverlayVideo } from "./test-fixtures.js";

describe("frameChangeSamples", () => {
  const W = 8;
  const H = 6;
  const grid = { cols: 8, rows: 6 };
  const frame = (fill: number) => new Uint8Array(W * H).fill(fill);

  it("reports zero change for identical frames", () => {
    const samples = frameChangeSamples([frame(100), frame(100)], W, H, 30, grid);
    expect(samples).toEqual([{ time: 1 / 30, diff: 0, area: 0 }]);
  });

  it("reports a full-frame change with area 1", () => {
    const samples = frameChangeSamples([frame(0), frame(255)], W, H, 30, grid);
    expect(samples[0].diff).toBeCloseTo(100, 0);
    expect(samples[0].area).toBe(1);
  });

  it("sees a color change that grayscale cannot", () => {
    // Red (255,0,0) and a mid green (0,128,0) have near-identical luminance,
    // so a cut between them is invisible in a grayscale diff.
    const rgb = (r: number, g: number, b: number) => {
      const f = new Uint8Array(W * H * 3);
      for (let i = 0; i < W * H; i++) {
        f[i * 3] = r;
        f[i * 3 + 1] = g;
        f[i * 3 + 2] = b;
      }
      return f;
    };
    const samples = frameChangeSamples(
      [rgb(255, 0, 0), rgb(0, 128, 0)],
      W,
      H,
      30,
      { ...grid, channels: 3 }
    );
    expect(samples[0].diff).toBeGreaterThan(90);
    expect(samples[0].area).toBe(1);
  });

  it("reports a localized change with a small area", () => {
    const a = frame(100);
    const b = frame(100);
    // With a cell per pixel, flip a 2x3 region in one corner.
    for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) b[y * W + x] = 255;
    const samples = frameChangeSamples([a, b], W, H, 30, grid);
    expect(samples[0].area).toBeCloseTo(6 / 48, 2);
    expect(samples[0].diff).toBeGreaterThan(0);
    expect(samples[0].diff).toBeLessThan(20);
  });
});

// Quiet baseline of near-static frames with events injected at known times.
function track(length: number, fps = 30): FrameChangeSample[] {
  return Array.from({ length }, (_, i) => ({
    time: (i + 1) / fps,
    diff: 0.3,
    area: 0,
  }));
}

describe("pickSceneCuts", () => {
  it("returns nothing for a flat track", () => {
    expect(pickSceneCuts(track(120))).toEqual([]);
  });

  it("finds a full-frame spike and classifies it as a hard cut", () => {
    const samples = track(120);
    samples[60] = { time: samples[60].time, diff: 45, area: 1 };
    const cuts = pickSceneCuts(samples);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].type).toBe("cut");
    expect(cuts[0].area).toBe(1);
  });

  it("classifies a sustained full-frame change as a fade", () => {
    const samples = track(120);
    for (let i = 60; i < 69; i++) {
      samples[i] = { time: samples[i].time, diff: 10, area: 1 };
    }
    const cuts = pickSceneCuts(samples);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].type).toBe("fade");
  });

  it("classifies a localized change as an overlay regardless of strength", () => {
    const samples = track(120);
    samples[60] = { time: samples[60].time, diff: 30, area: 0.2 };
    const cuts = pickSceneCuts(samples);
    expect(cuts).toEqual([
      { time: cuts[0].time, score: 30, area: 0.2, type: "overlay" },
    ]);
  });

  it("catches a swap animated across several frames as one overlay", () => {
    // The case scdet's min(diff, delta-diff) score suppressed: the change is
    // spread over 4 frames, so no single frame towers over its neighbor.
    const samples = track(120);
    for (let i = 60; i < 64; i++) {
      samples[i] = { time: samples[i].time, diff: 3.5, area: 0.2 };
    }
    const cuts = pickSceneCuts(samples);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].type).toBe("overlay");
  });

  it("skips localized peaks riding on continuous motion — not a graphic", () => {
    // A person shifting in frame: elevated change for ~0.7s with a peak
    // inside it. Temporally isolated it is not, so no overlay is reported.
    const samples = track(120);
    for (let i = 50; i < 70; i++) {
      samples[i] = { time: samples[i].time, diff: 3, area: 0.3 };
    }
    samples[60] = { time: samples[60].time, diff: 5, area: 0.3 };
    expect(pickSceneCuts(samples)).toEqual([]);
  });

  it("dedupes detections closer than the minimum gap, keeping the strongest", () => {
    const samples = track(120);
    samples[60] = { time: samples[60].time, diff: 30, area: 1 };
    samples[62] = { time: samples[62].time, diff: 40, area: 1 };
    const cuts = pickSceneCuts(samples);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].score).toBe(40);
  });

  it("keeps detections farther apart than the minimum gap", () => {
    const samples = track(120);
    samples[30] = { time: samples[30].time, diff: 30, area: 1 };
    samples[90] = { time: samples[90].time, diff: 30, area: 1 };
    expect(pickSceneCuts(samples)).toHaveLength(2);
  });

  it("raises the threshold on busy footage instead of firing everywhere", () => {
    const samples = track(300).map((s, i) => ({
      ...s,
      diff: 5 + (i % 3),
      area: 0.8,
    }));
    expect(pickSceneCuts(samples)).toEqual([]);
  });
});

describe("detectSceneCuts (integration)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mimic-scdet-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("finds hard cuts at the true times and types them 'cut'", async () => {
    const video = path.join(dir, "cuts.mp4");
    await makeCutVideo(video, [
      { color: "black", seconds: 2 },
      { color: "white", seconds: 2 },
      { color: "black", seconds: 2 },
    ]);
    const cuts = await detectSceneCuts(video);
    expect(cuts).toHaveLength(2);
    expect(cuts[0].time).toBeCloseTo(2, 0);
    expect(cuts[1].time).toBeCloseTo(4, 0);
    expect(cuts.every((c) => c.type === "cut")).toBe(true);
  }, 60_000);

  it("finds a cut between two colors of equal brightness", async () => {
    // ffmpeg's "green" is #008000: its luminance matches red's almost exactly,
    // so this cut is invisible to a grayscale diff and was previously missed.
    const video = path.join(dir, "equal-luma.mp4");
    await makeCutVideo(video, [
      { color: "red", seconds: 2 },
      { color: "green", seconds: 2 },
    ]);
    const cuts = await detectSceneCuts(video);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].time).toBeCloseTo(2, 0);
    expect(cuts[0].type).toBe("cut");
  }, 60_000);

  it("detects graphic swaps on a held shot as overlays, not cuts", async () => {
    const video = path.join(dir, "overlay.mp4");
    await makeOverlayVideo(video, ["0x333333", "0x808080", "0xCCCCCC"], 2);
    const cuts = await detectSceneCuts(video);
    const overlays = cuts.filter((c) => c.type === "overlay");
    expect(cuts.filter((c) => c.type !== "overlay")).toEqual([]);
    expect(overlays).toHaveLength(2);
    expect(overlays[0].time).toBeCloseTo(2, 0);
    expect(overlays[1].time).toBeCloseTo(4, 0);
  }, 60_000);

  it("detects a dissolve and types it 'fade'", async () => {
    const video = path.join(dir, "fade.mp4");
    await makeFadeVideo(video, { offsetSeconds: 2, fadeSeconds: 0.3 });
    const cuts = await detectSceneCuts(video);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].time).toBeCloseTo(2, 0);
    expect(cuts[0].type).toBe("fade");
  }, 60_000);
});
