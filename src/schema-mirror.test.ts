import { describe, expect, it } from "vitest";
import { z } from "zod";
import { recipeSchema, segmentSchema } from "./recipe.js";
import {
  recipeSchema as templateRecipeSchema,
  segmentSchema as templateSegmentSchema,
} from "../templates/remotion/src/recipeSchema.js";

/**
 * The recipe schema exists twice: the server's copy validates what the agent
 * writes, the template's copy drives Remotion Studio's props panel. They are
 * hand-mirrored, so a field added to one and forgotten in the other silently
 * disappears from the editing UI (or worse, renders and then fails validation).
 * These tests are the only thing keeping the two honest.
 */

const keysOf = (schema: z.ZodObject<z.ZodRawShape>): string[] =>
  Object.keys(schema.shape).sort();

describe("recipe schema mirror", () => {
  it("has the same segment fields on both sides", () => {
    expect(keysOf(templateSegmentSchema)).toEqual(keysOf(segmentSchema));
  });

  it("has the same top-level fields on both sides", () => {
    expect(keysOf(templateRecipeSchema)).toEqual(keysOf(recipeSchema));
  });

  it("parses a fully-populated segment identically on both sides", () => {
    const segment = {
      start: 0,
      end: 2,
      caption: "one two three",
      captionStyle: "hook",
      captionOutline: { color: "#000", widthPx: 8 },
      captionBackground: "rgba(0,0,0,0.7)",
      emphasisWords: [2],
      emphasisColor: "#ffe000",
      captionAnimation: "karaoke",
      wordTimings: [0, 0.3, 0.6],
      zoom: { from: 1, to: 1.2, focusX: 0.5, focusY: 0.4, easing: "easeOut" },
      videoTransitionIn: { kind: "dissolve", durationSeconds: 0.4 },
    };
    expect(templateSegmentSchema.parse(segment)).toEqual(segmentSchema.parse(segment));
  });
});
