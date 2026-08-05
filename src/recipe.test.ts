import { describe, expect, it } from "vitest";
import { parseRecipe } from "./recipe.js";

const minimalRecipe = {
  output: { durationSeconds: 10 },
  background: { video: "/footage.mp4" },
  segments: [{ start: 0, end: 5, caption: "hello world" }],
};

describe("parseRecipe", () => {
  it("accepts a minimal recipe and fills defaults", () => {
    const recipe = parseRecipe(JSON.stringify(minimalRecipe));
    expect(recipe.output.width).toBe(1080);
    expect(recipe.output.height).toBe(1920);
    expect(recipe.output.fps).toBe(30);
    expect(recipe.segments[0].captionStyle).toBe("plain");
    expect(recipe.segments[0].transitionIn).toBe("cut");
  });

  it("rejects invalid JSON", () => {
    expect(() => parseRecipe("{not json")).toThrow("not valid JSON");
  });

  it("rejects a segment ending before it starts", () => {
    const bad = structuredClone(minimalRecipe);
    bad.segments[0] = { start: 5, end: 5, caption: "x" };
    expect(() => parseRecipe(JSON.stringify(bad))).toThrow("must be after start");
  });

  it("rejects wordTimings that don't match the caption's word count", () => {
    const bad = structuredClone(minimalRecipe) as Record<string, unknown> & {
      segments: Record<string, unknown>[];
    };
    bad.segments[0] = {
      start: 0,
      end: 5,
      caption: "three word caption",
      wordTimings: [0, 1],
    };
    expect(() => parseRecipe(JSON.stringify(bad))).toThrow("wordTimings");
  });

  it("rejects a recipe whose last segment overruns the output duration", () => {
    const bad = structuredClone(minimalRecipe);
    bad.segments[0] = { start: 0, end: 11, caption: "x" };
    expect(() => parseRecipe(JSON.stringify(bad))).toThrow("durationSeconds");
  });
});
