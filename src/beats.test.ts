import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { estimateBpm } from "./analysis.js";
import { parseAubioBeats, tryAubioBeats } from "./aubio.js";
import { detectBeats } from "./ffmpeg.js";
import { makeClickTrack } from "./test-fixtures.js";

const grid = (bpm: number, count: number, start = 0): number[] =>
  Array.from({ length: count }, (_, i) => start + (i * 60) / bpm);

describe("estimateBpm", () => {
  it("recovers the tempo of a clean beat grid", () => {
    expect(estimateBpm(grid(120, 16))).toBe(120);
    expect(estimateBpm(grid(90, 16))).toBe(90);
  });

  it("tolerates timing jitter", () => {
    // Deterministic non-systematic jitter of up to ±8ms, like real detections.
    const jittered = grid(120, 16).map((t, i) => t + 0.008 * Math.sin(i * 2.7));
    expect(estimateBpm(jittered)).toBe(120);
  });

  it("survives off-beat extra onsets that break a median-gap estimate", () => {
    // Half the onsets are off-beat hits: the median inter-onset gap is ~0.2s
    // (300 BPM), but the true grid is 120 BPM.
    const onsets = [...grid(120, 16), ...grid(120, 15, 0.2)].sort((a, b) => a - b);
    const medianGapBpm = 300;
    const bpm = estimateBpm(onsets);
    expect(bpm).toBe(120);
    expect(bpm).not.toBe(medianGapBpm);
  });

  it("returns null for too few onsets", () => {
    expect(estimateBpm([0, 0.5, 1])).toBeNull();
  });

  it("returns null when the onsets have no periodicity", () => {
    expect(estimateBpm([0, 0.13, 1.91, 2.03])).toBeNull();
  });
});

describe("parseAubioBeats", () => {
  it("parses one timestamp per line and ignores junk", () => {
    expect(parseAubioBeats("0.512000\n1.024000\n\nnot-a-number\n1.536000\n")).toEqual([
      0.51, 1.02, 1.54,
    ]);
  });
});

describe("beat detection (integration)", () => {
  let dir: string;
  let clicks: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mimic-beats-"));
    clicks = path.join(dir, "clicks.wav");
    // 120 BPM click track: a click every 0.5s for 8 seconds.
    await makeClickTrack(clicks, grid(120, 16, 0.5), 9);
  }, 60_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("RMS fallback finds the clicks and the right tempo", async () => {
    const { beats, bpm } = await detectBeats(clicks);
    expect(beats.length).toBeGreaterThanOrEqual(12);
    expect(bpm).toBe(120);
    // Every true click time should have a detected onset within 60ms.
    for (const t of grid(120, 16, 0.5)) {
      const nearest = Math.min(...beats.map((b) => Math.abs(b - t)));
      expect(nearest).toBeLessThan(0.06);
    }
  }, 60_000);

  it("aubio path returns null without the CLI, real beats with it", async () => {
    const beats = await tryAubioBeats(clicks);
    if (beats === null) {
      expect(beats).toBeNull(); // no aubio on this machine — fallback covers it
    } else {
      expect(beats.length).toBeGreaterThanOrEqual(8);
      expect(estimateBpm(beats)).toBe(120);
    }
  }, 60_000);
});
