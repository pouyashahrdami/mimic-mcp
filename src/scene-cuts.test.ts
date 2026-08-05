import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  parseScdetSamples,
  pickSceneCuts,
  type ScdetSample,
} from "./analysis.js";
import { detectSceneCuts } from "./ffmpeg.js";
import { makeCutVideo, makeFadeVideo } from "./test-fixtures.js";

describe("parseScdetSamples", () => {
  it("pairs pts_time with the scd score and mafd that follow it", () => {
    const stderr = [
      "[Parsed_metadata_1 @ 0x1] frame:0    pts:0      pts_time:0",
      "[Parsed_metadata_1 @ 0x1] frame:1    pts:512    pts_time:0.033333",
      "[Parsed_metadata_1 @ 0x1] lavfi.scd.mafd=4.500",
      "[Parsed_metadata_1 @ 0x1] lavfi.scd.score=2.100",
      "[Parsed_metadata_1 @ 0x1] frame:2    pts:1024   pts_time:0.066667",
      "[Parsed_metadata_1 @ 0x1] lavfi.scd.mafd=48.000",
      "[Parsed_metadata_1 @ 0x1] lavfi.scd.score=43.500",
    ].join("\n");

    expect(parseScdetSamples(stderr)).toEqual([
      { time: 0.033333, score: 2.1, mafd: 4.5 },
      { time: 0.066667, score: 43.5, mafd: 48 },
    ]);
  });

  it("skips frames without a score (the first frame)", () => {
    const stderr = "frame:0 pts:0 pts_time:0\nframe:1 pts:512 pts_time:0.03";
    expect(parseScdetSamples(stderr)).toEqual([]);
  });
});

// Build a quiet score track with events injected at known frames.
function track(length: number, fps = 30): ScdetSample[] {
  return Array.from({ length }, (_, i) => ({
    time: i / fps,
    score: 0.5,
    mafd: 0.5,
  }));
}

describe("pickSceneCuts", () => {
  it("returns nothing for a flat track", () => {
    expect(pickSceneCuts(track(120))).toEqual([]);
  });

  it("finds an isolated spike and classifies it as a hard cut", () => {
    const samples = track(120);
    samples[60] = { time: 2, score: 45, mafd: 45 };
    const cuts = pickSceneCuts(samples);
    expect(cuts).toEqual([{ time: 2, score: 45, type: "cut" }]);
  });

  it("classifies a spike followed by sustained frame difference as a fade", () => {
    const samples = track(120);
    // Fade start spikes the score; the dissolve keeps mafd near the peak.
    samples[60] = { time: 2, score: 26, mafd: 26 };
    for (let i = 61; i < 70; i++) samples[i] = { ...samples[i], mafd: 24 };
    const cuts = pickSceneCuts(samples);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].type).toBe("fade");
  });

  it("dedupes detections closer than the minimum gap, keeping the strongest", () => {
    const samples = track(120);
    samples[60] = { time: 2, score: 30, mafd: 30 };
    samples[62] = { time: 62 / 30, score: 40, mafd: 40 };
    const cuts = pickSceneCuts(samples);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].score).toBe(40);
  });

  it("keeps detections farther apart than the minimum gap", () => {
    const samples = track(120);
    samples[30] = { time: 1, score: 30, mafd: 30 };
    samples[90] = { time: 3, score: 30, mafd: 30 };
    expect(pickSceneCuts(samples)).toHaveLength(2);
  });

  it("raises the threshold on busy footage instead of firing everywhere", () => {
    // Noisy handheld footage: constant moderate scores, no real cut.
    const samples = track(300).map((s, i) => ({
      ...s,
      score: 8 + (i % 3),
      mafd: 8 + (i % 3),
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

  it("detects a dissolve and types it 'fade'", async () => {
    const video = path.join(dir, "fade.mp4");
    await makeFadeVideo(video, { offsetSeconds: 2, fadeSeconds: 0.3 });
    const cuts = await detectSceneCuts(video);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].time).toBeCloseTo(2, 0);
    expect(cuts[0].type).toBe("fade");
  }, 60_000);
});
