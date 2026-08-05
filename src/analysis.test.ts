import { describe, expect, it } from "vitest";
import { planFilmstrip, planShotFrames, shotsFromCuts } from "./analysis.js";

describe("shotsFromCuts", () => {
  it("returns one full-length shot when there are no cuts", () => {
    expect(shotsFromCuts([], 10)).toEqual([{ start: 0, end: 10 }]);
  });

  it("splits the duration at each cut", () => {
    expect(shotsFromCuts([2, 5], 10)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 5 },
      { start: 5, end: 10 },
    ]);
  });

  it("drops zero-length shots from duplicate boundaries", () => {
    const shots = shotsFromCuts([2, 2.005, 10], 10);
    expect(shots).toEqual([
      { start: 0, end: 2 },
      { start: 2.005, end: 10 },
    ]);
  });
});

describe("planShotFrames", () => {
  it("plans start/mid/end frames for a normal shot", () => {
    const frames = planShotFrames([{ start: 2, end: 6 }]);
    expect(frames).toEqual([
      { shotIndex: 0, position: "start", atSeconds: 2.15 },
      { shotIndex: 0, position: "mid", atSeconds: 4 },
      { shotIndex: 0, position: "end", atSeconds: 5.85 },
    ]);
  });

  it("insets by a quarter of the shot when the shot is short", () => {
    const frames = planShotFrames([{ start: 0, end: 0.6 }]);
    expect(frames.map((f) => f.position)).toEqual(["start", "mid", "end"]);
    expect(frames[0].atSeconds).toBeCloseTo(0.15, 5);
    expect(frames[1].atSeconds).toBeCloseTo(0.3, 5);
    expect(frames[2].atSeconds).toBeCloseTo(0.45, 5);
  });

  it("plans a single mid frame for flash cuts", () => {
    const frames = planShotFrames([{ start: 1, end: 1.3 }]);
    expect(frames).toEqual([{ shotIndex: 0, position: "mid", atSeconds: 1.15 }]);
  });

  it("keeps all frames inside the shot", () => {
    const shots = [
      { start: 0, end: 0.2 },
      { start: 0.2, end: 3 },
      { start: 3, end: 30 },
    ];
    for (const f of planShotFrames(shots)) {
      const shot = shots[f.shotIndex];
      expect(f.atSeconds).toBeGreaterThan(shot.start);
      expect(f.atSeconds).toBeLessThan(shot.end);
    }
  });

  it("samples an evenly spaced subset when there are too many shots", () => {
    const shots = Array.from({ length: 40 }, (_, i) => ({
      start: i,
      end: i + 1,
    }));
    const frames = planShotFrames(shots, 8);
    const sampledShots = [...new Set(frames.map((f) => f.shotIndex))];
    expect(sampledShots).toHaveLength(8);
    expect(sampledShots[0]).toBe(0);
    expect(sampledShots.at(-1)).toBeGreaterThanOrEqual(30);
  });
});

describe("planFilmstrip", () => {
  it("samples an even grid across a normal shot", () => {
    const plan = planFilmstrip(2, 6, 30)!;
    expect(plan.frameTimes).toHaveLength(12);
    expect(plan.frameTimes[0]).toBe(2);
    expect(plan.frameTimes[11]).toBeLessThan(6);
    expect(plan.cols).toBe(4);
    expect(plan.rows).toBe(3);
    expect(plan.fps).toBeCloseTo(3, 1);
  });

  it("uses every native frame for a flash cut shorter than the budget", () => {
    // 0.2s at 30fps = 6 native frames; all of them beat 12 interpolated ones.
    const plan = planFilmstrip(1, 1.2, 30)!;
    expect(plan.frameTimes.length).toBe(6);
    expect(plan.fps).toBeCloseTo(30, 0);
  });

  it("returns null for spans too short to strip", () => {
    expect(planFilmstrip(1, 1.02, 30)).toBeNull();
    expect(planFilmstrip(5, 5, 30)).toBeNull();
  });
});
