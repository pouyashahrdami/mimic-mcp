import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCutVideo } from "../test-fixtures.js";
import { analyzeReference, type ReferenceAnalysis } from "./analyze-reference.js";

// Integration test against a synthetic video with hard cuts at 2s and 4s.
describe("analyzeReference", () => {
  let workDir: string;
  let analysis: ReferenceAnalysis;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "mimic-analyze-"));
    const video = path.join(workDir, "reference.mp4");
    // High-contrast colors so the luma jump at each cut is unambiguous.
    await makeCutVideo(video, [
      { color: "black", seconds: 2 },
      { color: "white", seconds: 2 },
      { color: "black", seconds: 2 },
    ]);
    analysis = await analyzeReference(video, workDir);
  }, 60_000);

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("finds the two hard cuts near their true times", () => {
    expect(analysis.sceneCuts).toHaveLength(2);
    expect(analysis.sceneCuts[0]).toBeCloseTo(2, 0);
    expect(analysis.sceneCuts[1]).toBeCloseTo(4, 0);
  });

  it("reports three shots of about two seconds each", () => {
    expect(analysis.shots).toHaveLength(3);
    for (const shot of analysis.shots) {
      expect(shot.seconds).toBeCloseTo(2, 0);
    }
    expect(analysis.averageShotSeconds).toBeCloseTo(2, 0);
  });

  it("extracts start/mid/end frames for every shot", async () => {
    for (const shot of analysis.shots) {
      expect(shot.frames.map((f) => f.position)).toEqual(["start", "mid", "end"]);
      for (const frame of shot.frames) {
        expect(frame.atSeconds).toBeGreaterThan(shot.start);
        expect(frame.atSeconds).toBeLessThan(shot.end);
        const info = await stat(frame.file);
        expect(info.size).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the flat keyframes list in sync with the shot frames", () => {
    const shotFrameFiles = analysis.shots.flatMap((s) => s.frames.map((f) => f.file));
    expect(analysis.keyframes.map((k) => k.file)).toEqual(shotFrameFiles);
  });

  // Regression: when the audio stream outruns the video stream, frame
  // extraction must not seek past the last video frame.
  it("plans frames within the video stream when the audio runs longer", async () => {
    const video = path.join(workDir, "audio-longer.mp4");
    await makeCutVideo(video, [{ color: "gray", seconds: 4 }], { audioSeconds: 5 });
    const a = await analyzeReference(video, workDir);
    expect(a.durationSeconds).toBeGreaterThan(4.5);
    for (const shot of a.shots) {
      expect(shot.end).toBeLessThanOrEqual(4.1);
      for (const frame of shot.frames) {
        const info = await stat(frame.file);
        expect(info.size).toBeGreaterThan(0);
      }
    }
  }, 60_000);
});
