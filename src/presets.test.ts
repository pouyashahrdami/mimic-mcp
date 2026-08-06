import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractPreset, presetSchema } from "./presets.js";
import { parseRecipe } from "./recipe.js";

describe("shipped presets", () => {
  // listPresets silently skips malformed files, so a broken built-in would
  // vanish from the listing without any signal. Pin them here instead.
  it("all validate against the preset schema", async () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "presets");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const raw = JSON.parse(await readFile(path.join(dir, file), "utf8"));
      expect(() => presetSchema.parse(raw), `${file} failed validation`).not.toThrow();
    }
  });
});

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
