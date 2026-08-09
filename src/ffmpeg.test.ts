import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { concatRanges, probe, trimSilence } from "./ffmpeg.js";
import { makeCutVideo, makeVideoWithSilentGaps } from "./test-fixtures.js";

// The jump-cut primitive behind both trim_silence and edit_by_transcript.
describe("concatRanges", () => {
  let workDir: string;
  let source: string;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "mimic-concat-"));
    source = path.join(workDir, "source.mp4");
    await makeCutVideo(
      source,
      [
        { color: "black", seconds: 2 },
        { color: "white", seconds: 2 },
        { color: "black", seconds: 2 },
      ],
      { audioSeconds: 6 }
    );
  }, 60_000);

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("keeps only the given ranges, back to back", async () => {
    const out = path.join(workDir, "kept.mp4");
    await concatRanges(source, out, [
      { start: 0, end: 1 },
      { start: 4, end: 5 },
    ]);
    const info = await probe(out);
    expect(info.durationSeconds).toBeGreaterThan(1.8);
    expect(info.durationSeconds).toBeLessThan(2.2);
    expect(info.hasAudio).toBe(true);
  }, 60_000);

  it("passes a single range through at its own length", async () => {
    const out = path.join(workDir, "one.mp4");
    await concatRanges(source, out, [{ start: 1, end: 4 }]);
    const info = await probe(out);
    expect(info.durationSeconds).toBeGreaterThan(2.8);
    expect(info.durationSeconds).toBeLessThan(3.2);
  }, 60_000);

  it("fails loudly rather than writing an empty file", async () => {
    await expect(concatRanges(source, path.join(workDir, "none.mp4"), [])).rejects.toThrow(
      /nothing left to keep/
    );
  });

  // trim_silence builds its ranges from silencedetect and hands them here, so
  // this covers the seam the refactor moved.
  it("still backs trim_silence end to end", async () => {
    const spoken = path.join(workDir, "spoken.mp4");
    await makeVideoWithSilentGaps(spoken, [{ start: 2, end: 4 }], 6);

    const out = path.join(workDir, "tight.mp4");
    const result = await trimSilence(spoken, out, -30, 0.5);

    expect(result.cutsRemoved).toBe(1);
    // The 2s gap goes, leaving the two tone halves joined.
    expect(result.trimmedSeconds).toBeGreaterThan(3.8);
    expect(result.trimmedSeconds).toBeLessThan(4.4);
    expect(result.removedSeconds).toBeGreaterThan(1.5);
  }, 60_000);
});
