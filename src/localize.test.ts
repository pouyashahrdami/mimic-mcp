import { describe, expect, it } from "vitest";
import { localizeRecipe } from "./localize.js";
import { parseRecipe, type Recipe } from "./recipe.js";

const BASE = {
  output: { durationSeconds: 6 },
  background: { video: "/footage.mp4" },
  segments: [
    {
      start: 0,
      end: 3,
      caption: "stop scrolling now",
      captionAnimation: "karaoke",
      wordTimings: [0, 0.5, 1],
      emphasisWords: [2],
    },
    { start: 3, end: 6, caption: "here is why" },
  ],
};

function recipe(overrides: Record<string, unknown> = {}): Recipe {
  return parseRecipe(JSON.stringify({ ...structuredClone(BASE), ...overrides }));
}

describe("localizeRecipe", () => {
  it("swaps every caption for its translation", () => {
    const { recipe: out } = localizeRecipe(recipe(), {
      language: "de",
      captions: ["hör auf zu scrollen", "darum geht es"],
    });
    expect(out.segments.map((s) => s.caption)).toEqual([
      "hör auf zu scrollen",
      "darum geht es",
    ]);
  });

  it("refuses a mismatched number of lines instead of guessing", () => {
    expect(() => localizeRecipe(recipe(), { language: "de", captions: ["only one"] })).toThrow(
      /one line per segment/
    );
  });

  it("needs a language tag", () => {
    expect(() => localizeRecipe(recipe(), { language: " ", captions: ["a", "b"] })).toThrow(
      /language tag/
    );
  });

  it("drops word timings whose word count no longer matches", () => {
    const { recipe: out, notes } = localizeRecipe(recipe(), {
      language: "de",
      captions: ["hör auf zu scrollen", "darum"],
    });
    expect(out.segments[0].wordTimings).toBeUndefined();
    expect(notes.join(" ")).toMatch(/lost their word timings/);
  });

  it("keeps karaoke when matching word timings are supplied", () => {
    const { recipe: out, notes } = localizeRecipe(recipe(), {
      language: "de",
      captions: ["hör auf jetzt", "darum"],
      wordTimings: [[0, 0.4, 0.9], undefined],
    });
    expect(out.segments[0].wordTimings).toEqual([0, 0.4, 0.9]);
    expect(notes.join(" ")).not.toMatch(/lost their word timings/);
  });

  it("ignores supplied timings that don't match the translated word count", () => {
    const { recipe: out } = localizeRecipe(recipe(), {
      language: "de",
      captions: ["hör auf jetzt sofort", "darum"],
      wordTimings: [[0, 0.4], undefined],
    });
    expect(out.segments[0].wordTimings).toBeUndefined();
  });

  it("clears emphasis indices that now point past the caption", () => {
    const { recipe: out, notes } = localizeRecipe(recipe(), {
      language: "de",
      captions: ["kurz", "darum"],
    });
    expect(out.segments[0].emphasisWords).toBeUndefined();
    expect(notes.join(" ")).toMatch(/emphasisWords/);
  });

  it("keeps emphasis indices that still fit", () => {
    const { recipe: out } = localizeRecipe(recipe(), {
      language: "de",
      captions: ["hör auf jetzt", "darum"],
    });
    expect(out.segments[0].emphasisWords).toEqual([2]);
  });

  it("warns when the translation runs much longer than the original", () => {
    const { notes } = localizeRecipe(recipe(), {
      language: "de",
      captions: [
        "hör sofort auf zu scrollen denn das hier ist wirklich wichtig für dich",
        "darum geht es",
      ],
    });
    expect(notes.join(" ")).toMatch(/read faster/);
  });

  it("says nothing when the translation is a clean swap", () => {
    const clean = recipe({
      segments: [
        { start: 0, end: 3, caption: "one two three" },
        { start: 3, end: 6, caption: "four five" },
      ],
    });
    const { notes } = localizeRecipe(clean, {
      language: "fr",
      captions: ["un deux trois", "quatre cinq"],
    });
    expect(notes).toEqual([]);
  });

  it("allows a segment to stay captionless", () => {
    const { recipe: out } = localizeRecipe(recipe(), {
      language: "de",
      captions: ["hör auf jetzt", ""],
    });
    expect(out.segments[1].caption).toBe("");
  });

  it("leaves the result a valid recipe", () => {
    const { recipe: out } = localizeRecipe(recipe(), {
      language: "de",
      captions: ["hör auf zu scrollen", "darum geht es"],
    });
    expect(() => parseRecipe(JSON.stringify(out))).not.toThrow();
  });

  it("does not mutate the original recipe", () => {
    const input = recipe();
    localizeRecipe(input, { language: "de", captions: ["kurz", "darum"] });
    expect(input.segments[0].caption).toBe("stop scrolling now");
    expect(input.segments[0].wordTimings).toEqual([0, 0.5, 1]);
  });
});
