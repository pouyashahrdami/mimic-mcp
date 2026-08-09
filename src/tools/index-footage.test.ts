import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USABLE_SCORE } from "../footage-index.js";
import { makeCutVideo, makeOverlayVideo } from "../test-fixtures.js";
import { indexFootage, type FootageIndexResult } from "./index-footage.js";

// Integration test against a synthetic footage folder: one clip that cuts
// black -> white at 2s, and one held gray clip with a graphic swapping on it.
describe("indexFootage", () => {
  let workDir: string;
  let footageDir: string;
  let result: FootageIndexResult;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "mimic-index-"));
    footageDir = path.join(workDir, "footage");
    await mkdir(footageDir, { recursive: true });

    await makeCutVideo(path.join(footageDir, "interview.mp4"), [
      { color: "black", seconds: 2 },
      { color: "white", seconds: 2 },
    ]);
    await makeOverlayVideo(path.join(footageDir, "cards.mp4"), ["red", "blue"], 1.5);

    result = await indexFootage([footageDir], workDir);
  }, 120_000);

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("expands a directory into every video inside it", () => {
    expect(result.clips.map((c) => path.basename(c.file)).sort()).toEqual([
      "cards.mp4",
      "interview.mp4",
    ]);
  });

  it("splits a clip at its cut and names each shot after its clip", () => {
    const ids = result.shots.map((s) => s.id).sort();
    expect(ids).toContain("interview#1");
    expect(ids).toContain("interview#2");
  });

  it("does not split a held shot at an on-screen graphic swap", () => {
    const cards = result.shots.filter((s) => s.id.startsWith("cards#"));
    expect(cards).toHaveLength(1);
  });

  it("measures the exposure of each shot", () => {
    const shots = new Map(result.shots.map((s) => [s.id, s]));
    expect(shots.get("interview#1")?.quality.flaws).toContain("dark");
    expect(shots.get("interview#2")?.quality.flaws).toContain("blown");
  });

  it("calls a flat color field flat and detail-less", () => {
    const flatShot = result.shots.find((s) => s.id === "interview#1");
    expect(flatShot?.quality.flaws).toContain("flat");
    expect(flatShot?.quality.flaws).toContain("soft");
    expect(flatShot?.quality.score).toBeLessThan(USABLE_SCORE);
  });

  it("ranks shots best-first", () => {
    const scores = result.shots.map((s) => s.quality.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("writes a filmstrip per shot", async () => {
    for (const shot of result.shots) {
      expect(shot.filmstrip).toBeTruthy();
      const info = await stat(shot.filmstrip as string);
      expect(info.size).toBeGreaterThan(0);
    }
  });

  it("warns about the shots that scored badly", () => {
    expect(result.notes.join(" ")).toMatch(/scored below/);
  });

  it("leaves assignments off unless needs were asked for", () => {
    expect(result.assignments).toBeNull();
  });

  it("assigns a shot per segment when needs are given", async () => {
    const assigned = await indexFootage([footageDir], workDir, {
      needs: [{ durationSeconds: 1 }, { durationSeconds: 1.5 }],
      filmstrips: false,
    });
    expect(assigned.assignments).toHaveLength(2);
    const used = assigned.assignments?.map((a) => a.shotId) ?? [];
    expect(new Set(used).size).toBe(2);
  }, 60_000);

  it("rejects a path that does not exist", async () => {
    await expect(indexFootage([path.join(workDir, "nope")], workDir)).rejects.toThrow(
      /does not exist/
    );
  });

  it("rejects a directory with no video in it", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "mimic-empty-"));
    await expect(indexFootage([empty], workDir)).rejects.toThrow(/no video files/);
    await rm(empty, { recursive: true, force: true });
  });
});
