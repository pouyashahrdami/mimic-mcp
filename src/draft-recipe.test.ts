import { describe, expect, it } from "vitest";
import { draftRecipe, snapBoundaries } from "./draft-recipe.js";
import type { StyleSpec } from "./style-spec.js";
import type { CaptionEvent } from "./captions.js";

function caption(over: Partial<CaptionEvent> & { text: string; start: number; end: number }): CaptionEvent {
  return {
    x: 0.1,
    y: 0.4,
    w: 0.8,
    h: 0.07,
    band: "center",
    uppercase: true,
    lineHeight: 0.07,
    ...over,
  };
}

function spec(over: Partial<StyleSpec> = {}): StyleSpec {
  return {
    source: "/tmp/ref.mp4",
    durationSeconds: 6,
    width: 1080,
    height: 1920,
    fps: 30,
    shots: [
      { start: 0, end: 2, motion: null },
      { start: 2, end: 4, motion: null },
      { start: 4, end: 6, motion: null },
    ],
    transitions: [],
    overlayChanges: [],
    captions: null,
    beats: [],
    bpm: null,
    ...over,
  };
}

describe("snapBoundaries", () => {
  it("moves interior boundaries onto the nearest beat within tolerance", () => {
    const { bounds, snapped } = snapBoundaries([0, 1.95, 4.04, 6], [2, 4], 0.12);
    expect(bounds).toEqual([0, 2, 4, 6]);
    expect(snapped).toBe(2);
  });

  it("leaves boundaries beyond tolerance alone", () => {
    const { bounds, snapped } = snapBoundaries([0, 1.5, 6], [2], 0.12);
    expect(bounds).toEqual([0, 1.5, 6]);
    expect(snapped).toBe(0);
  });

  it("never snaps a segment below the minimum length", () => {
    const { bounds, snapped } = snapBoundaries([0, 2, 2.1, 6], [2.05], 0.12);
    expect(bounds).toEqual([0, 2, 2.1, 6]);
    expect(snapped).toBe(0);
  });

  it("keeps the first and last boundaries fixed", () => {
    const { bounds } = snapBoundaries([0.05, 3, 5.9], [0, 3.02, 6], 0.12);
    expect(bounds[0]).toBe(0.05);
    expect(bounds[2]).toBe(5.9);
  });
});

describe("draftRecipe", () => {
  it("projects one segment per measured shot", () => {
    const { recipe } = draftRecipe(spec(), { script: ["one", "two", "three"] });
    expect(recipe.segments.map((s) => [s.start, s.end])).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
    ]);
    expect(recipe.segments.map((s) => s.caption)).toEqual(["one", "two", "three"]);
    expect(recipe.output).toMatchObject({ width: 1080, height: 1920, fps: 30, durationSeconds: 6 });
  });

  it("copies measured transitions verbatim, skipping cuts and segment 0", () => {
    const { recipe } = draftRecipe(
      spec({
        transitions: [
          { time: 2, kind: "dissolve", durationSeconds: 0.4 },
          { time: 4, kind: "cut", durationSeconds: 0 },
        ],
      }),
      { script: ["a", "b", "c"], footageVideo: "/tmp/f.mov", footageDurationSeconds: 30 }
    );
    expect(recipe.segments[0].videoTransitionIn).toBeUndefined();
    expect(recipe.segments[1].videoTransitionIn).toMatchObject({
      kind: "dissolve",
      durationSeconds: 0.4,
    });
    expect(recipe.segments[2].videoTransitionIn).toBeUndefined();
  });

  it("copies in-shot zoom with its fitted easing and ignores static shots", () => {
    const { recipe } = draftRecipe(
      spec({
        shots: [
          { start: 0, end: 2, motion: { type: "zoom", scaleTo: 1.18, panX: 0, panY: 0, easing: "easeOut" } },
          { start: 2, end: 4, motion: { type: "static", scaleTo: 1, panX: 0, panY: 0, easing: null } },
          { start: 4, end: 6, motion: null },
        ],
      }),
      { script: ["a", "b", "c"] }
    );
    expect(recipe.segments[0].zoom).toMatchObject({ from: 1, to: 1.18, easing: "easeOut" });
    expect(recipe.segments[1].zoom).toBeUndefined();
    expect(recipe.segments[2].zoom).toBeUndefined();
  });

  it("takes caption band, size and style from the OCR track", () => {
    const { recipe } = draftRecipe(
      spec({
        captions: [
          caption({ text: "BIG HOOK", start: 0.1, end: 1.9 }),
          caption({ text: "a tip", start: 2.1, end: 3.9, band: "bottom", uppercase: false, lineHeight: 0.03 }),
        ],
      }),
      { script: ["my hook", "my tip"] }
    );
    expect(recipe.segments[0]).toMatchObject({
      caption: "my hook",
      captionStyle: "hook",
      captionPosition: "center",
      captionSize: Math.round(0.07 * 1920),
    });
    expect(recipe.segments[1]).toMatchObject({
      caption: "my tip",
      captionStyle: "tip",
      captionPosition: "bottom",
    });
    // The reference showed no text over the third shot, so it stays clean.
    expect(recipe.segments[2].caption).toBe("");
  });

  it("snaps segment boundaries to beats and says so", () => {
    const { recipe, notes } = draftRecipe(
      spec({
        shots: [
          { start: 0, end: 1.94, motion: null },
          { start: 1.94, end: 4.05, motion: null },
          { start: 4.05, end: 6, motion: null },
        ],
        beats: [2, 4],
        bpm: 120,
      }),
      { script: ["a", "b", "c"] }
    );
    expect(recipe.segments.map((s) => s.start)).toEqual([0, 2, 4]);
    expect(notes.join(" ")).toMatch(/Snapped 2 segment boundaries/);
  });

  it("honours snapToBeats: false", () => {
    const { recipe } = draftRecipe(
      spec({
        shots: [
          { start: 0, end: 1.94, motion: null },
          { start: 1.94, end: 6, motion: null },
        ],
        beats: [2],
      }),
      { script: ["a", "b"], snapToBeats: false }
    );
    expect(recipe.segments[1].start).toBe(1.94);
  });

  it("only offsets per-segment footage when the footage is long enough", () => {
    const short = draftRecipe(spec(), {
      script: ["a"],
      footageVideo: "/tmp/f.mov",
      footageDurationSeconds: 3,
    });
    expect(short.recipe.segments[1].backgroundStart).toBeUndefined();

    const long = draftRecipe(spec(), {
      script: ["a"],
      footageVideo: "/tmp/f.mov",
      footageDurationSeconds: 30,
    });
    expect(long.recipe.segments[1].backgroundStart).toBe(2);
  });

  it("flags leftover script lines and pans it cannot express", () => {
    const { notes } = draftRecipe(
      spec({
        shots: [
          { start: 0, end: 3, motion: { type: "pan", scaleTo: 1, panX: 0.2, panY: 0, easing: "linear" } },
          { start: 3, end: 6, motion: null },
        ],
      }),
      { script: ["a", "b", "c", "d"] }
    );
    expect(notes.join(" ")).toMatch(/2 script line\(s\) had no shot/);
    expect(notes.join(" ")).toMatch(/Segments 0 pan in the reference/);
  });

  it("aims the crop and the punch-in at the measured subject", () => {
    const { recipe, notes } = draftRecipe(
      spec({
        shots: [
          { start: 0, end: 3, motion: { type: "zoom", scaleTo: 1.2, panX: 0, panY: 0, easing: "easeOut" } },
          { start: 3, end: 6, motion: null },
        ],
      }),
      {
        script: ["a", "b"],
        footageVideo: "/tmp/f.mov",
        footageDurationSeconds: 30,
        framings: [
          { focusX: 0.24, focusY: 0.35, backgroundPosition: "24% 35%" },
          { focusX: 0.5, focusY: 0.5, backgroundPosition: null },
        ],
      }
    );
    expect(recipe.segments[0].backgroundPosition).toBe("24% 35%");
    expect(recipe.segments[0].zoom).toMatchObject({ focusX: 0.24, focusY: 0.35 });
    // No confident measurement: leave it centred rather than aim at noise.
    expect(recipe.segments[1].backgroundPosition).toBeUndefined();
    expect(notes.join(" ")).toMatch(/1 segment\(s\) aimed at the subject/);
  });

  it("ignores framings when the reel has no footage to aim", () => {
    const { recipe } = draftRecipe(spec(), {
      script: ["a"],
      backgroundFill: "#000",
      framings: [{ focusX: 0.2, focusY: 0.2, backgroundPosition: "20% 20%" }],
    });
    expect(recipe.segments[0].backgroundPosition).toBeUndefined();
  });

  it("falls back to a dark canvas when there is no footage and no fill", () => {
    const { recipe, notes } = draftRecipe(spec(), { script: ["a", "b", "c"] });
    expect(recipe.background.video).toBeUndefined();
    expect(recipe.background.fill).toBe("#0b0b0f");
    expect(notes.join(" ")).toMatch(/No footage and no fill/);
  });

  it("wires music through", () => {
    const { recipe } = draftRecipe(spec(), { script: ["a"], musicFile: "/tmp/music.m4a" });
    expect(recipe.music).toMatchObject({ file: "/tmp/music.m4a", volume: 0.8 });
  });

  it("fails loud on a spec with no shots", () => {
    expect(() => draftRecipe(spec({ shots: [] }), { script: ["a"] })).toThrow(/no shots/);
  });
});
