import { describe, expect, it } from "vitest";
import { applyBrandKit, brandKitSchema, type BrandKit } from "./brand-kit.js";
import { parseRecipe, type Recipe } from "./recipe.js";

const BASE = {
  output: { durationSeconds: 6 },
  background: { video: "/footage.mp4" },
  segments: [
    { start: 0, end: 3, caption: "one" },
    { start: 3, end: 6, caption: "two" },
  ],
};

function recipe(overrides: Record<string, unknown> = {}): Recipe {
  return parseRecipe(JSON.stringify({ ...structuredClone(BASE), ...overrides }));
}

const KIT: BrandKit = brandKitSchema.parse({
  name: "mine",
  description: "my marks",
  overlays: [
    { kind: "image", file: "/logo.png", corner: "top-right", size: 0.1 },
    { kind: "text", text: "@handle", corner: "bottom-left", size: 0.035 },
  ],
  caption: { captionFont: "Inter", captionColor: "#ffe000" },
  googleFonts: ["Inter"],
});

describe("applyBrandKit", () => {
  it("adds the kit's overlays to a reel that has none", () => {
    const { recipe: out, changes } = applyBrandKit(recipe(), KIT);
    expect(out.overlays).toHaveLength(2);
    expect(changes.join(" ")).toMatch(/added 2 overlay/);
  });

  it("is idempotent — applying twice leaves one logo, not two", () => {
    const once = applyBrandKit(recipe(), KIT).recipe;
    const twice = applyBrandKit(once, KIT);
    expect(twice.recipe.overlays).toHaveLength(2);
    expect(twice.changes.join(" ")).toMatch(/already on this reel/);
  });

  it("keeps an overlay the reel added itself", () => {
    const withOwn = recipe({
      overlays: [{ kind: "text", text: "one-off", corner: "top-left" }],
    });
    const { recipe: out } = applyBrandKit(withOwn, KIT);
    expect(out.overlays).toHaveLength(3);
    expect(out.overlays?.some((o) => o.text === "one-off")).toBe(true);
  });

  it("fills caption defaults into segments that made no choice", () => {
    const { recipe: out } = applyBrandKit(recipe(), KIT);
    expect(out.segments.every((s) => s.captionFont === "Inter")).toBe(true);
    expect(out.segments.every((s) => s.captionColor === "#ffe000")).toBe(true);
  });

  it("does not overrule a choice the recipe made on purpose", () => {
    const opinionated = recipe({
      segments: [
        { start: 0, end: 3, caption: "one", captionColor: "#ff0000" },
        { start: 3, end: 6, caption: "two" },
      ],
    });
    const { recipe: out } = applyBrandKit(opinionated, KIT);
    expect(out.segments[0].captionColor).toBe("#ff0000");
    expect(out.segments[1].captionColor).toBe("#ffe000");
  });

  it("overrules it when explicitly asked to", () => {
    const opinionated = recipe({
      segments: [
        { start: 0, end: 3, caption: "one", captionColor: "#ff0000" },
        { start: 3, end: 6, caption: "two" },
      ],
    });
    const { recipe: out, changes } = applyBrandKit(opinionated, KIT, { overwrite: true });
    expect(out.segments[0].captionColor).toBe("#ffe000");
    expect(changes.join(" ")).toMatch(/overwrote/);
  });

  it("merges fonts without duplicating one already loaded", () => {
    const withFont = recipe({ googleFonts: ["Inter", "Bebas Neue"] });
    const { recipe: out } = applyBrandKit(withFont, KIT);
    expect(out.googleFonts).toEqual(["Inter", "Bebas Neue"]);
  });

  it("says plainly when there was nothing to do", () => {
    const applied = applyBrandKit(recipe(), KIT).recipe;
    const again = applyBrandKit(applied, {
      name: "mine",
      description: "",
      caption: { captionFont: "Inter" },
    });
    expect(again.changes.join(" ")).toMatch(/nothing to apply/);
  });

  it("leaves a recipe valid after merging", () => {
    const { recipe: out } = applyBrandKit(recipe(), KIT);
    expect(() => parseRecipe(JSON.stringify(out))).not.toThrow();
  });

  it("does not mutate the recipe it was given", () => {
    const input = recipe();
    applyBrandKit(input, KIT);
    expect(input.overlays).toBeUndefined();
    expect(input.segments[0].captionFont).toBeUndefined();
  });

  it("handles a kit that carries nothing", () => {
    const empty = brandKitSchema.parse({ name: "empty" });
    const { recipe: out, changes } = applyBrandKit(recipe(), empty);
    expect(out.overlays).toBeUndefined();
    expect(changes.join(" ")).toMatch(/nothing to apply/);
  });
});

describe("brandKitSchema", () => {
  it("needs only a name", () => {
    expect(() => brandKitSchema.parse({ name: "minimal" })).not.toThrow();
  });

  it("validates the overlays it carries", () => {
    expect(() =>
      brandKitSchema.parse({ name: "bad", overlays: [{ kind: "nonsense" }] })
    ).toThrow();
  });
});
