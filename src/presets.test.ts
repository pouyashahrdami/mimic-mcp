import { describe, expect, it } from "vitest";
import { extractPreset } from "./presets.js";
import { parseRecipe } from "./recipe.js";

describe("extractPreset", () => {
  it("keeps the typographic look and zoom easing, drops content", () => {
    const recipe = parseRecipe(
      JSON.stringify({
        output: { durationSeconds: 10 },
        background: { video: "/footage.mp4" },
        music: { file: "/music.m4a", volume: 0.6 },
        segments: [
          {
            start: 0,
            end: 5,
            caption: "editorial look",
            captionFont: "Georgia, serif",
            captionWeight: 400,
            captionSize: 54,
            zoom: { from: 1, to: 1.12, easing: "easeOut" },
          },
        ],
      })
    );

    const preset = extractPreset(recipe, "serif-pov", "delicate serif look");
    const seg = preset.segments[0];
    expect(seg.captionFont).toBe("Georgia, serif");
    expect(seg.captionWeight).toBe(400);
    expect(seg.captionSize).toBe(54);
    expect(seg.zoom?.easing).toBe("easeOut");
    expect(seg.durationSeconds).toBe(5);
    expect(preset.musicVolume).toBe(0.6);
    expect(JSON.stringify(preset)).not.toContain("footage.mp4");
    expect(JSON.stringify(preset)).not.toContain("editorial look");
  });
});
