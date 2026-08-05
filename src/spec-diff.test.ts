import { describe, expect, it } from "vitest";
import { diffSpecs } from "./spec-diff.js";
import type { StyleSpec } from "./style-spec.js";

const baseSpec = (overrides: Partial<StyleSpec> = {}): StyleSpec => ({
  source: "ref.mp4",
  durationSeconds: 10,
  width: 1080,
  height: 1920,
  fps: 30,
  shots: [],
  transitions: [],
  overlayChanges: [],
  captions: [],
  beats: [],
  bpm: null,
  ...overrides,
});

const caption = (text: string, start: number, end: number, overrides = {}) => ({
  text,
  start,
  end,
  x: 0.3,
  y: 0.7,
  w: 0.4,
  h: 0.03,
  band: "bottom" as const,
  uppercase: false,
  lineHeight: 0.03,
  ...overrides,
});

describe("diffSpecs", () => {
  it("scores identical specs 100 with no issues", () => {
    const spec = baseSpec({
      transitions: [{ time: 5, kind: "cut", durationSeconds: 0.03 }],
      captions: [caption("hello", 1, 4)],
    });
    const diff = diffSpecs(spec, structuredClone(spec));
    expect(diff.score).toBe(100);
    expect(diff.issues).toHaveLength(0);
    expect(diff.cuts.matched).toHaveLength(1);
  });

  it("flags a missing cut and an extra cut", () => {
    const ref = baseSpec({
      transitions: [{ time: 3, kind: "cut", durationSeconds: 0.03 }],
    });
    const render = baseSpec({
      transitions: [{ time: 7, kind: "cut", durationSeconds: 0.03 }],
    });
    const diff = diffSpecs(ref, render);
    expect(diff.cuts.missedReference).toEqual([3]);
    expect(diff.cuts.extraRender).toEqual([7]);
    expect(diff.score).toBeLessThan(100);
    expect(diff.issues.join(" ")).toContain("no matching cut");
  });

  it("measures cut timing error on matched cuts", () => {
    const ref = baseSpec({ transitions: [{ time: 5, kind: "cut", durationSeconds: 0.03 }] });
    const render = baseSpec({ transitions: [{ time: 5.25, kind: "cut", durationSeconds: 0.03 }] });
    const diff = diffSpecs(ref, render);
    expect(diff.cuts.matched[0].errorSeconds).toBeCloseTo(0.25, 5);
    expect(diff.issues.join(" ")).toContain("late");
  });

  it("rescales reference times when durations differ", () => {
    const ref = baseSpec({
      durationSeconds: 20,
      transitions: [{ time: 10, kind: "cut", durationSeconds: 0.03 }],
    });
    const render = baseSpec({
      durationSeconds: 10,
      transitions: [{ time: 5, kind: "cut", durationSeconds: 0.03 }],
    });
    const diff = diffSpecs(ref, render);
    expect(diff.cuts.matched).toHaveLength(1);
    expect(diff.cuts.matched[0].errorSeconds).toBe(0);
  });

  it("flags a transition kind mismatch with the fix", () => {
    const ref = baseSpec({
      transitions: [{ time: 5, kind: "dissolve", durationSeconds: 0.4 }],
    });
    const render = baseSpec({
      transitions: [{ time: 5, kind: "cut", durationSeconds: 0.03 }],
    });
    const diff = diffSpecs(ref, render);
    expect(diff.transitions[0].match).toBe(false);
    expect(diff.issues.join(" ")).toContain('videoTransitionIn to "dissolve"');
  });

  it("flags reference motion missing from the render", () => {
    const ref = baseSpec({
      shots: [
        {
          start: 0,
          end: 5,
          motion: { type: "zoom", scaleTo: 1.12, panX: 0, panY: 0, easing: "easeOut" },
        },
      ],
    });
    const render = baseSpec({
      shots: [{ start: 0, end: 5, motion: { type: "static", scaleTo: 1, panX: 0, panY: 0, easing: null } }],
    });
    const diff = diffSpecs(ref, render);
    expect(diff.issues.join(" ")).toContain("add a zoom");
  });

  it("compares captions by timing overlap and flags size drift", () => {
    const ref = baseSpec({ captions: [caption("original text", 1, 4)] });
    const render = baseSpec({
      captions: [caption("my new words", 1.1, 4, { lineHeight: 0.015, h: 0.015 })],
    });
    const diff = diffSpecs(ref, render);
    expect(diff.captions).toHaveLength(1);
    expect(diff.captions[0].sizeRatio).toBe(0.5);
    expect(diff.issues.join(" ")).toContain("captionSize");
  });

  it("flags a reference caption with nothing on screen in the render", () => {
    const ref = baseSpec({ captions: [caption("lonely", 1, 4)] });
    const render = baseSpec({ captions: [] });
    const diff = diffSpecs(ref, render);
    expect(diff.issues.join(" ")).toContain("no on-screen text");
  });
});
