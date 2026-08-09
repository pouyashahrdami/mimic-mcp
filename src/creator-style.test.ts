import { describe, expect, it } from "vitest";
import { presetFromCreator, summarizeCreator } from "./creator-style.js";
import { presetSchema } from "./presets.js";
import type { StyleSpec } from "./style-spec.js";
import type { CaptionEvent } from "./captions.js";
import type { MeasuredTransition } from "./style-spec.js";

interface SpecOptions {
  source?: string;
  shotSeconds?: number[];
  transitions?: MeasuredTransition["kind"][];
  motion?: ("static" | "zoom" | "pan" | "zoom+pan")[];
  captions?: Partial<CaptionEvent>[];
  bpm?: number | null;
}

/** A StyleSpec built from shot lengths, the way analysis would have measured it. */
function spec({
  source = "reel.mp4",
  shotSeconds = [2, 2, 2],
  transitions = [],
  motion = [],
  captions,
  bpm = null,
}: SpecOptions = {}): StyleSpec {
  let cursor = 0;
  const shots = shotSeconds.map((seconds, i) => {
    const start = cursor;
    cursor += seconds;
    const type = motion[i];
    return {
      start,
      end: cursor,
      motion: type
        ? { type, scaleTo: 1.1, panX: 0, panY: 0, easing: "easeInOut" as const }
        : null,
    };
  });

  return {
    source,
    durationSeconds: cursor,
    width: 1080,
    height: 1920,
    fps: 30,
    shots,
    transitions: transitions.map((kind, i) => ({
      time: shots[i]?.end ?? i,
      kind,
      durationSeconds: kind === "cut" ? 0 : 0.3,
    })),
    overlayChanges: [],
    captions:
      captions?.map((c, i) => ({
        text: `caption ${i}`,
        start: i,
        end: i + 1.5,
        x: 0.1,
        y: 0.7,
        w: 0.8,
        h: 0.1,
        band: "bottom" as const,
        uppercase: false,
        lineHeight: 0.06,
        ...c,
      })) ?? null,
    bpm,
    beats: [],
  };
}

describe("summarizeCreator", () => {
  it("refuses an empty body of work", () => {
    expect(() => summarizeCreator([])).toThrow(/no reels/);
  });

  it("refuses when nothing measurable came back", () => {
    expect(() => summarizeCreator([spec({ shotSeconds: [] })])).toThrow(/measurable shot/);
  });

  it("names the reels it had to skip instead of silently dropping them", () => {
    const style = summarizeCreator([
      spec({ source: "good.mp4" }),
      spec({ source: "empty.mp4", shotSeconds: [] }),
    ]);
    expect(style.reels).toBe(1);
    expect(style.skipped).toEqual(["empty.mp4"]);
  });

  it("reports a range, not just an average", () => {
    const style = summarizeCreator([
      spec({ shotSeconds: [1, 2, 3, 4] }),
      spec({ shotSeconds: [1, 2, 3, 4] }),
    ]);
    expect(style.shotSeconds.min).toBe(1);
    expect(style.shotSeconds.max).toBe(4);
    expect(style.shotSeconds.p25).toBeLessThan(style.shotSeconds.p75);
    expect(style.shotSeconds.samples).toBe(8);
  });

  it("warns that two reels can't separate a habit from an accident", () => {
    const style = summarizeCreator([spec(), spec()]);
    expect(style.notes.join(" ")).toMatch(/provisional/);
  });

  it("drops the warning once there are enough reels", () => {
    const style = summarizeCreator([spec(), spec(), spec()]);
    expect(style.notes.join(" ")).not.toMatch(/provisional/);
  });

  it("ranks the transitions this creator actually reaches for", () => {
    const style = summarizeCreator([
      spec({ transitions: ["cut", "cut", "dissolve"] }),
      spec({ transitions: ["cut", "cut", "cut"] }),
      spec({ transitions: ["cut", "dissolve", "cut"] }),
    ]);
    expect(style.transitions[0].value).toBe("cut");
    expect(style.transitions[0].share).toBeGreaterThan(0.7);
    expect(style.transitions[1].value).toBe("dissolve");
  });

  it("summarizes how often shots move at all", () => {
    const style = summarizeCreator([
      spec({ shotSeconds: [2, 2], motion: ["static", "zoom"] }),
      spec({ shotSeconds: [2, 2], motion: ["static", "static"] }),
      spec({ shotSeconds: [2, 2], motion: ["static", "zoom"] }),
    ]);
    expect(style.motion[0]).toEqual({ value: "static", share: 0.67 });
  });

  it("calls a consistent cutter consistent", () => {
    const tight = summarizeCreator([
      spec({ shotSeconds: [2, 2, 2] }),
      spec({ shotSeconds: [2, 2, 2] }),
      spec({ shotSeconds: [2, 2, 2] }),
    ]);
    expect(tight.consistency).toBe(1);
  });

  it("calls out a creator whose reels don't agree on a rhythm", () => {
    const loose = summarizeCreator([
      spec({ shotSeconds: [0.5, 0.5, 0.5] }),
      spec({ shotSeconds: [8, 8, 8] }),
      spec({ shotSeconds: [3, 3, 3] }),
    ]);
    expect(loose.consistency).toBeLessThan(0.4);
  });

  it("summarizes caption habits across reels", () => {
    const style = summarizeCreator([
      spec({ captions: [{ band: "top", uppercase: true }, { band: "top", uppercase: true }] }),
      spec({ captions: [{ band: "top", uppercase: false }] }),
      spec({ captions: [{ band: "bottom", uppercase: true }] }),
    ]);
    expect(style.captions.band).toEqual({ value: "top", share: 0.75 });
    expect(style.captions.uppercaseShare).toBe(0.75);
    expect(style.captions.lineHeight?.median).toBe(0.06);
  });

  it("says caption habits are unknown rather than absent when OCR gave nothing", () => {
    const style = summarizeCreator([spec(), spec(), spec()]);
    expect(style.captions.band).toBeNull();
    expect(style.captions.uppercaseShare).toBeNull();
    expect(style.notes.join(" ")).toMatch(/unknown, not absent/);
  });

  it("summarizes tempo only from the reels that had one", () => {
    const style = summarizeCreator([
      spec({ bpm: 120 }),
      spec({ bpm: 124 }),
      spec({ bpm: null }),
    ]);
    expect(style.bpm?.samples).toBe(2);
    expect(style.bpm?.median).toBeGreaterThanOrEqual(120);
  });
});

describe("presetFromCreator", () => {
  const style = summarizeCreator([
    spec({ shotSeconds: [2, 2, 2, 2], transitions: ["cut", "cut", "cut"] }),
    spec({ shotSeconds: [2, 2, 2, 2], transitions: ["cut", "cut", "cut"] }),
    spec({ shotSeconds: [2, 2, 2, 2], transitions: ["cut", "cut", "cut"] }),
  ]);

  it("produces a preset the schema accepts", () => {
    const preset = presetFromCreator(style, { width: 1080, height: 1920, fps: 30 }, "a", "b");
    expect(() => presetSchema.parse(preset)).not.toThrow();
  });

  it("builds it from the middle of the measured distributions", () => {
    const preset = presetFromCreator(style, { width: 1080, height: 1920, fps: 30 }, "a", "b");
    expect(preset.segments).toHaveLength(4);
    expect(preset.segments[0].durationSeconds).toBe(2);
  });

  it("opens on the hook and leaves the rest plain", () => {
    const preset = presetFromCreator(style, { width: 1080, height: 1920, fps: 30 }, "a", "b");
    expect(preset.segments[0].captionStyle).toBe("hook");
    expect(preset.segments.slice(1).every((s) => s.captionStyle === "plain")).toBe(true);
  });

  it("maps a measured dissolve onto the preset's fade", () => {
    const fading = summarizeCreator([
      spec({ shotSeconds: [2, 2], transitions: ["dissolve", "dissolve"] }),
      spec({ shotSeconds: [2, 2], transitions: ["dissolve", "dissolve"] }),
      spec({ shotSeconds: [2, 2], transitions: ["dissolve", "dissolve"] }),
    ]);
    const preset = presetFromCreator(fading, { width: 1080, height: 1920, fps: 30 }, "a", "b");
    expect(preset.segments[1].transitionIn).toBe("fade");
    // The reel's first frame isn't a transition into anything.
    expect(preset.segments[0].transitionIn).toBe("cut");
  });

  it("carries the caption band the creator favours", () => {
    const topBanded = summarizeCreator([
      spec({ captions: [{ band: "top" }, { band: "top" }] }),
      spec({ captions: [{ band: "top" }] }),
      spec({ captions: [{ band: "top" }] }),
    ]);
    const preset = presetFromCreator(topBanded, { width: 1080, height: 1920, fps: 30 }, "a", "b");
    expect(preset.segments[0].captionPosition).toBe("top");
  });

  it("never emits a zero-length or empty preset", () => {
    const sparse = summarizeCreator([spec({ shotSeconds: [0.1] })]);
    const preset = presetFromCreator(sparse, { width: 1080, height: 1920, fps: 30 }, "a", "b");
    expect(preset.segments.length).toBeGreaterThanOrEqual(1);
    expect(preset.segments[0].durationSeconds).toBeGreaterThan(0);
    expect(() => presetSchema.parse(preset)).not.toThrow();
  });
});
