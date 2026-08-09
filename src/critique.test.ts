import { describe, expect, it } from "vitest";
import { critiqueRecipe } from "./critique.js";
import { parseRecipe, type Recipe } from "./recipe.js";

/**
 * A reel with nothing wrong with it: opens immediately, captions readable and
 * outlined, varied holds, vertical.
 */
const CLEAN = {
  output: { durationSeconds: 9 },
  background: { video: "/footage.mp4" },
  segments: [
    {
      start: 0,
      end: 2.5,
      caption: "Your reels look generic",
      captionOutline: { color: "#000", widthPx: 6 },
    },
    {
      start: 2.5,
      end: 5.5,
      caption: "Here is the fix",
      captionOutline: { color: "#000", widthPx: 6 },
    },
    {
      start: 5.5,
      end: 9,
      caption: "Copy the pacing, not the content",
      captionOutline: { color: "#000", widthPx: 6 },
    },
  ],
};

function recipe(overrides: Record<string, unknown> = {}): Recipe {
  return parseRecipe(JSON.stringify({ ...structuredClone(CLEAN), ...overrides }));
}

/** The recipe with one segment replaced wholesale. */
function withSegments(segments: Record<string, unknown>[]): Recipe {
  return recipe({ segments });
}

function kinds(r: Recipe): string[] {
  return critiqueRecipe(r).issues.map((i) => i.kind);
}

describe("critiqueRecipe", () => {
  it("passes a reel with nothing measurably wrong", () => {
    const result = critiqueRecipe(recipe());
    expect(result.issues).toEqual([]);
    expect(result.score).toBe(100);
  });

  it("reports what it measured either way", () => {
    const { measurements } = critiqueRecipe(recipe());
    expect(measurements.segments).toBe(3);
    expect(measurements.durationSeconds).toBe(9);
    expect(measurements.meanSegmentSeconds).toBe(3);
    expect(measurements.segmentLengthSpread).toBeGreaterThan(0);
  });

  it("flags a caption nobody could finish reading", () => {
    const r = withSegments([
      {
        start: 0,
        end: 1,
        caption: "this is far too many words to read in a single second of screen time",
        captionOutline: { color: "#000", widthPx: 6 },
      },
      { start: 1, end: 9, caption: "ok", captionOutline: { color: "#000", widthPx: 6 } },
    ]);
    const issue = critiqueRecipe(r).issues.find((i) => i.kind === "caption-too-fast");
    expect(issue?.severity).toBe("high");
    expect(issue?.message).toMatch(/words\/sec/);
    expect(issue?.field).toMatch(/segments\[\]\.end/);
  });

  it("separates a merely rushed caption from an unreadable one", () => {
    // 6 words in 1.2s = 5 words/sec: over comfortable, under the hard limit.
    const r = withSegments([
      {
        start: 0,
        end: 1.2,
        caption: "six little words go by here",
        captionOutline: { color: "#000", widthPx: 6 },
      },
      { start: 1.2, end: 9, caption: "ok", captionOutline: { color: "#000", widthPx: 6 } },
    ]);
    expect(kinds(r)).toContain("caption-rushed");
    expect(kinds(r)).not.toContain("caption-too-fast");
  });

  it("flags a caption with nothing separating it from the footage", () => {
    const r = withSegments([
      { start: 0, end: 3, caption: "bare white text" },
      { start: 3, end: 9, caption: "also bare" },
    ]);
    expect(kinds(r)).toContain("caption-no-separation");
  });

  it("accepts an outline, a background pill, or the tip style as separation", () => {
    const outlined = withSegments([
      { start: 0, end: 4, caption: "outlined", captionOutline: { color: "#000", widthPx: 4 } },
      { start: 4, end: 9, caption: "outlined too", captionOutline: { color: "#000", widthPx: 4 } },
    ]);
    const pilled = withSegments([
      { start: 0, end: 4, caption: "pilled", captionBackground: "rgba(0,0,0,0.7)" },
      { start: 4, end: 9, caption: "pilled too", captionBackground: "rgba(0,0,0,0.7)" },
    ]);
    const tips = withSegments([
      { start: 0, end: 4, caption: "tip style", captionStyle: "tip" },
      { start: 4, end: 9, caption: "tip style too", captionStyle: "tip" },
    ]);

    for (const r of [outlined, pilled, tips]) {
      expect(kinds(r)).not.toContain("caption-no-separation");
    }
  });

  it("does not ask an outline of a segment with no caption", () => {
    const r = withSegments([
      { start: 0, end: 4, caption: "opens fine", captionOutline: { color: "#000", widthPx: 6 } },
      { start: 4, end: 9, caption: "" },
    ]);
    expect(kinds(r)).not.toContain("caption-no-separation");
  });

  it("flags a reel that says nothing in its opening window", () => {
    const r = withSegments([
      { start: 0, end: 3, caption: "" },
      { start: 3, end: 9, caption: "the point", captionOutline: { color: "#000", widthPx: 6 } },
    ]);
    const issue = critiqueRecipe(r).issues.find((i) => i.kind === "no-hook");
    expect(issue?.severity).toBe("high");
  });

  it("flags a first caption that arrives late", () => {
    const r = withSegments([
      { start: 1, end: 4, caption: "late open", captionOutline: { color: "#000", widthPx: 6 } },
      { start: 4, end: 9, caption: "rest", captionOutline: { color: "#000", widthPx: 6 } },
    ]);
    expect(kinds(r)).toContain("late-start");
  });

  it("flags metronomic pacing, but only with enough segments to see it", () => {
    const even = withSegments(
      [0, 3, 6].map((start) => ({
        start,
        end: start + 3,
        caption: "same length every time",
        captionOutline: { color: "#000", widthPx: 6 },
      }))
    );
    expect(kinds(even)).toContain("metronomic");

    const two = withSegments([
      { start: 0, end: 4.5, caption: "one", captionOutline: { color: "#000", widthPx: 6 } },
      { start: 4.5, end: 9, caption: "two", captionOutline: { color: "#000", widthPx: 6 } },
    ]);
    expect(kinds(two)).not.toContain("metronomic");
  });

  it("flags dead air where nothing is said", () => {
    const r = recipe({
      output: { durationSeconds: 20 },
      segments: [
        { start: 0, end: 3, caption: "opens", captionOutline: { color: "#000", widthPx: 6 } },
        { start: 3, end: 20, caption: "" },
      ],
    });
    const result = critiqueRecipe(r);
    expect(result.measurements.silentSeconds).toBe(17);
    expect(result.issues.find((i) => i.kind === "dead-air")?.severity).toBe("medium");
  });

  it("counts a voiceover as covering the silence", () => {
    const withVoice = recipe({
      output: { durationSeconds: 20 },
      voiceover: { file: "/vo.mp3", startSeconds: 0, durationSeconds: 20 },
      segments: [
        { start: 0, end: 3, caption: "opens", captionOutline: { color: "#000", widthPx: 6 } },
        { start: 3, end: 20, caption: "" },
      ],
    });
    expect(critiqueRecipe(withVoice).measurements.silentSeconds).toBe(0);
    expect(kinds(withVoice)).not.toContain("dead-air");
  });

  it("flags a shot held too long and a caption left up too long", () => {
    const r = recipe({
      output: { durationSeconds: 20 },
      segments: [
        {
          start: 0,
          end: 20,
          caption: "one long held line",
          captionOutline: { color: "#000", widthPx: 6 },
        },
      ],
    });
    expect(kinds(r)).toContain("segment-long");
    expect(kinds(r)).toContain("caption-stale");
  });

  it("flags a reel past short-form length", () => {
    const r = recipe({
      output: { durationSeconds: 120 },
      segments: [
        { start: 0, end: 60, caption: "half", captionOutline: { color: "#000", widthPx: 6 } },
        { start: 60, end: 120, caption: "rest", captionOutline: { color: "#000", widthPx: 6 } },
      ],
    });
    expect(kinds(r)).toContain("reel-long");
  });

  it("flags a landscape output", () => {
    const r = recipe({ output: { durationSeconds: 9, width: 1920, height: 1080 } });
    expect(kinds(r)).toContain("not-vertical");
  });

  it("sorts issues worst-first and never scores below zero", () => {
    const wrecked = recipe({
      output: { durationSeconds: 200, width: 1920, height: 1080 },
      segments: [
        { start: 0, end: 100, caption: "" },
        {
          start: 100,
          end: 100.5,
          caption: "far too many words crammed into a fraction of one single second here",
        },
        { start: 100.5, end: 200, caption: "trailing" },
      ],
    });
    const result = critiqueRecipe(wrecked);
    const severities = result.issues.map((i) => i.severity);
    const rank = { high: 0, medium: 1, low: 2 };
    expect(severities.map((s) => rank[s])).toEqual(
      [...severities.map((s) => rank[s])].sort((a, b) => a - b)
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
