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

  it("accepts per-segment speed and captionFont", () => {
    const withStyle = structuredClone(minimalRecipe) as typeof minimalRecipe & {
      segments: Record<string, unknown>[];
    };
    withStyle.segments[0] = {
      start: 0,
      end: 5,
      caption: "sped up",
      speed: 2.5,
      captionFont: "Georgia, 'Times New Roman', serif",
    };
    const recipe = parseRecipe(JSON.stringify(withStyle));
    expect(recipe.segments[0].speed).toBe(2.5);
    expect(recipe.segments[0].captionFont).toContain("Georgia");
  });

  it("rejects a non-positive or absurd speed", () => {
    for (const speed of [0, -1, 40]) {
      const bad = structuredClone(minimalRecipe) as typeof minimalRecipe & {
        segments: Record<string, unknown>[];
      };
      bad.segments[0] = { start: 0, end: 5, caption: "x", speed };
      expect(() => parseRecipe(JSON.stringify(bad))).toThrow();
    }
  });

  it("accepts measured video transitions and eased zooms", () => {
    const rich = structuredClone(minimalRecipe) as typeof minimalRecipe & {
      segments: Record<string, unknown>[];
    };
    rich.segments = [
      { start: 0, end: 5, caption: "first", zoom: { to: 1.12, easing: "easeOut" } },
      {
        start: 5,
        end: 10,
        caption: "second",
        backgroundStart: 20,
        videoTransitionIn: { kind: "dissolve", durationSeconds: 0.4 },
      },
    ];
    const recipe = parseRecipe(JSON.stringify(rich));
    expect(recipe.segments[0].zoom?.easing).toBe("easeOut");
    expect(recipe.segments[1].videoTransitionIn?.kind).toBe("dissolve");
    expect(recipe.segments[1].videoTransitionIn?.durationSeconds).toBe(0.4);
  });

  it("defaults transition duration and zoom easing", () => {
    const rich = structuredClone(minimalRecipe) as typeof minimalRecipe & {
      segments: Record<string, unknown>[];
    };
    rich.segments = [
      { start: 0, end: 5, caption: "a", zoom: {} },
      { start: 5, end: 10, caption: "b", videoTransitionIn: { kind: "wipe", direction: "left" } },
    ];
    const recipe = parseRecipe(JSON.stringify(rich));
    expect(recipe.segments[0].zoom?.easing).toBe("linear");
    expect(recipe.segments[1].videoTransitionIn?.durationSeconds).toBe(0.3);
  });

  it("rejects a blend transition on the first segment but allows a dip", () => {
    const bad = structuredClone(minimalRecipe) as typeof minimalRecipe & {
      segments: Record<string, unknown>[];
    };
    bad.segments[0] = {
      start: 0,
      end: 5,
      caption: "x",
      videoTransitionIn: { kind: "dissolve" },
    };
    expect(() => parseRecipe(JSON.stringify(bad))).toThrow("previous segment");

    const ok = structuredClone(bad);
    ok.segments[0].videoTransitionIn = { kind: "dip-to-black" };
    expect(() => parseRecipe(JSON.stringify(ok))).not.toThrow();
  });

  it("accepts a from-scratch recipe with no video anywhere", () => {
    const scratch = {
      output: { durationSeconds: 10 },
      segments: [
        {
          start: 0,
          end: 5,
          caption: "designed",
          backgroundFill: "linear-gradient(160deg, #0f0c29, #302b63)",
        },
        { start: 5, end: 10, caption: "shot", backgroundImage: "/shot.png", zoom: { to: 1.2 } },
      ],
    };
    const recipe = parseRecipe(JSON.stringify(scratch));
    expect(recipe.background.video).toBeUndefined();
    expect(recipe.segments[0].backgroundFill).toContain("gradient");
    expect(recipe.segments[1].backgroundImage).toBe("/shot.png");
  });

  it("accepts a global fill as the only background", () => {
    const scratch = {
      output: { durationSeconds: 10 },
      background: { fill: "#111" },
      segments: [{ start: 0, end: 5, caption: "hello" }],
    };
    expect(parseRecipe(JSON.stringify(scratch)).background.fill).toBe("#111");
  });

  it("rejects a segment with no background anywhere", () => {
    const bad = {
      output: { durationSeconds: 10 },
      segments: [{ start: 0, end: 5, caption: "floating in the void" }],
    };
    expect(() => parseRecipe(JSON.stringify(bad))).toThrow("no background");
  });

  it("rejects a segment mixing background sources", () => {
    const bad = structuredClone(minimalRecipe) as typeof minimalRecipe & {
      segments: Record<string, unknown>[];
    };
    bad.segments[0] = {
      start: 0,
      end: 5,
      caption: "x",
      backgroundImage: "/shot.png",
      backgroundFill: "black",
    };
    expect(() => parseRecipe(JSON.stringify(bad))).toThrow("mutually exclusive");
  });

  it("rejects a recipe whose last segment overruns the output duration", () => {
    const bad = structuredClone(minimalRecipe);
    bad.segments[0] = { start: 0, end: 11, caption: "x" };
    expect(() => parseRecipe(JSON.stringify(bad))).toThrow("durationSeconds");
  });

  it("catches an overrun even when segments aren't listed in order", () => {
    const bad = structuredClone(minimalRecipe) as typeof minimalRecipe & {
      segments: Record<string, unknown>[];
    };
    bad.segments = [
      { start: 6, end: 11, caption: "overruns" },
      { start: 0, end: 6, caption: "listed last" },
    ];
    expect(() => parseRecipe(JSON.stringify(bad))).toThrow("durationSeconds");
  });
});
