import { describe, expect, it } from "vitest";
import { parseRecipe, type Recipe } from "./recipe.js";
import { buildHookVariants } from "./variants.js";

const BASE = {
  output: { durationSeconds: 9 },
  background: { video: "/footage.mp4" },
  segments: [
    {
      start: 0,
      end: 2,
      caption: "original hook",
      captionAnimation: "karaoke",
      wordTimings: [0, 0.8],
    },
    { start: 2, end: 5, caption: "body one" },
    { start: 5, end: 9, caption: "body two" },
  ],
};

function recipe(overrides: Record<string, unknown> = {}): Recipe {
  return parseRecipe(JSON.stringify({ ...structuredClone(BASE), ...overrides }));
}

describe("buildHookVariants", () => {
  it("makes one variant per hook", () => {
    const variants = buildHookVariants(recipe(), ["a hook", "b hook", "c hook"]);
    expect(variants).toHaveLength(3);
    expect(variants.map((v) => v.hook)).toEqual(["a hook", "b hook", "c hook"]);
  });

  it("changes only the opening caption", () => {
    const [variant] = buildHookVariants(recipe(), ["a brand new hook"]);
    expect(variant.recipe.segments[0].caption).toBe("a brand new hook");
    expect(variant.recipe.segments[1].caption).toBe("body one");
    expect(variant.recipe.segments[2].caption).toBe("body two");
  });

  it("reports which segments to re-render", () => {
    const [variant] = buildHookVariants(recipe(), ["x"]);
    expect(variant.changedSegments).toEqual([0]);
  });

  it("can replace a hook that spans several segments", () => {
    const variants = buildHookVariants(recipe(), ["shared hook"], { segments: [0, 1] });
    expect(variants[0].recipe.segments[0].caption).toBe("shared hook");
    expect(variants[0].recipe.segments[1].caption).toBe("shared hook");
    expect(variants[0].recipe.segments[2].caption).toBe("body two");
    expect(variants[0].changedSegments).toEqual([0, 1]);
  });

  it("drops karaoke timings the new hook invalidates, and says so", () => {
    const [variant] = buildHookVariants(recipe(), ["three words here"]);
    expect(variant.recipe.segments[0].wordTimings).toBeUndefined();
    expect(variant.notes.join(" ")).toMatch(/word timings were dropped/);
  });

  it("keeps timings when the hook happens to match the word count", () => {
    const [variant] = buildHookVariants(recipe(), ["two words"]);
    // Same count, but they are different words — the offsets are still stale,
    // so they go regardless.
    expect(variant.recipe.segments[0].wordTimings).toBeUndefined();
  });

  it("numbers variants by default and slugs them on request", () => {
    const numbered = buildHookVariants(recipe(), ["Stop Scrolling!", "Wait..."]);
    expect(numbered.map((v) => v.id)).toEqual(["hook-1", "hook-2"]);

    const slugged = buildHookVariants(recipe(), ["Stop Scrolling!", "Wait..."], {
      labelFromText: true,
    });
    expect(slugged.map((v) => v.id)).toEqual(["stop-scrolling", "wait"]);
  });

  it("falls back to a number when a hook slugs to nothing", () => {
    const [variant] = buildHookVariants(recipe(), ["!!!"], { labelFromText: true });
    expect(variant.id).toBe("hook-1");
  });

  it("refuses an empty hook list", () => {
    expect(() => buildHookVariants(recipe(), [])).toThrow(/at least one/);
  });

  it("refuses a segment index outside the reel", () => {
    expect(() => buildHookVariants(recipe(), ["x"], { segments: [7] })).toThrow(/outside this reel/);
    expect(() => buildHookVariants(recipe(), ["x"], { segments: [-1] })).toThrow(/outside this reel/);
  });

  it("leaves every variant a valid recipe", () => {
    for (const variant of buildHookVariants(recipe(), ["one", "two words here"])) {
      expect(() => parseRecipe(JSON.stringify(variant.recipe))).not.toThrow();
    }
  });

  it("does not mutate the original recipe", () => {
    const input = recipe();
    buildHookVariants(input, ["replacement"]);
    expect(input.segments[0].caption).toBe("original hook");
    expect(input.segments[0].wordTimings).toEqual([0, 0.8]);
  });
});
