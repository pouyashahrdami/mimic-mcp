/**
 * Learn a style from a BODY of work rather than from one reel.
 *
 * A single reference is a sample of a style, not the style: this creator cut
 * fast in that one because the topic was fast, and the caption sat top because
 * the shot was bottom-heavy. Analyze five of their reels and the habits
 * separate from the accidents — what recurs is the style, what varies is the
 * range they work in.
 *
 * So this reports DISTRIBUTIONS (cut length p25..p75, how often each transition
 * shows up, how consistent they are) instead of averages that read as facts,
 * and derives a preset from the middle of them.
 *
 * Pure: takes measured StyleSpecs, returns a summary and a preset.
 */

import type { TransitionKind } from "./analysis.js";
import type { Preset } from "./presets.js";
import type { StyleSpec } from "./style-spec.js";

export interface Distribution {
  median: number;
  /** The middle half of the values — the range the creator actually works in. */
  p25: number;
  p75: number;
  min: number;
  max: number;
  samples: number;
}

export interface Habit<T extends string> {
  value: T;
  /** 0..1 share of observations that took this value. */
  share: number;
}

export interface CreatorStyle {
  reels: number;
  /** Reels that contributed nothing measurable, named so the gap is visible. */
  skipped: string[];
  reelSeconds: Distribution;
  shotSeconds: Distribution;
  shotsPerReel: Distribution;
  bpm: Distribution | null;
  /** Transition kinds by how often this creator reaches for them, commonest first. */
  transitions: Habit<TransitionKind>[];
  /** Share of shots that hold still, punch in, pan, or both. */
  motion: Habit<"static" | "zoom" | "pan" | "zoom+pan">[];
  captions: {
    /** Null when no reel had a readable caption track (OCR unavailable). */
    band: Habit<"top" | "center" | "bottom"> | null;
    uppercaseShare: number | null;
    /** Line height as a fraction of frame height — the font-size proxy. */
    lineHeight: Distribution | null;
    onScreenSeconds: Distribution | null;
  };
  /**
   * 0..1. How tightly the reels agree on cut length: 1 means every reel cuts
   * at the same rhythm, low means the "style" is really several styles.
   */
  consistency: number;
  notes: string[];
}

function distribution(values: number[]): Distribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const round = (v: number): number => Math.round(v * 100) / 100;

  return {
    median: round(at(0.5)),
    p25: round(at(0.25)),
    p75: round(at(0.75)),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    samples: sorted.length,
  };
}

/** An empty distribution, for the fields callers always expect to be present. */
const EMPTY: Distribution = { median: 0, p25: 0, p75: 0, min: 0, max: 0, samples: 0 };

function habits<T extends string>(values: T[]): Habit<T>[] {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, share: Math.round((count / values.length) * 100) / 100 }))
    .sort((a, b) => b.share - a.share);
}

/**
 * How tightly the reels agree, as 1 - (spread / middle). Measured on each
 * reel's median shot length rather than on every shot: the question is whether
 * the CREATOR is consistent, and one reel with one long establishing shot
 * shouldn't read as an inconsistent style.
 */
function consistencyOf(perReelMedians: number[]): number {
  if (perReelMedians.length < 2) return 1;
  const mean = perReelMedians.reduce((sum, v) => sum + v, 0) / perReelMedians.length;
  if (mean <= 0) return 0;
  const spread = Math.sqrt(
    perReelMedians.reduce((sum, v) => sum + (v - mean) ** 2, 0) / perReelMedians.length
  );
  return Math.round(Math.max(0, 1 - spread / mean) * 100) / 100;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function summarizeCreator(specs: StyleSpec[]): CreatorStyle {
  if (specs.length === 0) throw new Error("no reels to learn from");

  const notes: string[] = [];
  const skipped = specs.filter((s) => s.shots.length === 0).map((s) => s.source);
  const usable = specs.filter((s) => s.shots.length > 0);
  if (usable.length === 0) {
    throw new Error("none of the reels had a measurable shot — analysis found no cuts at all");
  }
  if (specs.length < 3) {
    notes.push(
      `Only ${specs.length} reel(s). Habits and accidents are hard to tell apart below about ` +
        "three — treat the ranges as provisional."
    );
  }

  const shotLengths = usable.flatMap((s) => s.shots.map((shot) => shot.end - shot.start));
  const perReelMedian = usable.map((s) => median(s.shots.map((shot) => shot.end - shot.start)));

  const transitionKinds = usable.flatMap((s) => s.transitions.map((t) => t.kind));
  const motionTypes = usable.flatMap((s) =>
    s.shots.map((shot) => shot.motion?.type).filter((t): t is NonNullable<typeof t> => t != null)
  );

  const withCaptions = usable.filter((s) => s.captions != null && s.captions.length > 0);
  const captionEvents = withCaptions.flatMap((s) => s.captions ?? []);
  if (captionEvents.length === 0) {
    notes.push(
      "No caption track on any reel — either they carry no on-screen text, or OCR was " +
        "unavailable (macOS Vision only). Caption habits are unknown, not absent."
    );
  }

  const bpms = usable.map((s) => s.bpm).filter((b): b is number => b != null);

  return {
    reels: usable.length,
    skipped,
    reelSeconds: distribution(usable.map((s) => s.durationSeconds)) ?? EMPTY,
    shotSeconds: distribution(shotLengths) ?? EMPTY,
    shotsPerReel: distribution(usable.map((s) => s.shots.length)) ?? EMPTY,
    bpm: distribution(bpms),
    transitions: habits(transitionKinds),
    motion: habits(motionTypes),
    captions: {
      band: captionEvents.length > 0 ? habits(captionEvents.map((c) => c.band))[0] : null,
      uppercaseShare:
        captionEvents.length > 0
          ? Math.round(
              (captionEvents.filter((c) => c.uppercase).length / captionEvents.length) * 100
            ) / 100
          : null,
      lineHeight: distribution(captionEvents.map((c) => c.lineHeight)),
      onScreenSeconds: distribution(captionEvents.map((c) => c.end - c.start)),
    },
    consistency: consistencyOf(perReelMedian),
    notes,
  };
}

/** Transition kinds the preset schema can express; anything else becomes a cut. */
function presetTransition(kind: TransitionKind | undefined): "cut" | "fade" | "slide" {
  if (kind === "dissolve" || kind === "dip-to-black" || kind === "dip-to-white") return "fade";
  if (kind === "wipe") return "slide";
  return "cut";
}

/**
 * Turn the summary into a reusable preset, built from the middle of each
 * distribution: the creator's median shot count, at their median shot length,
 * with the transition and caption band they reach for most.
 */
export function presetFromCreator(
  style: CreatorStyle,
  spec: Pick<StyleSpec, "width" | "height" | "fps">,
  name: string,
  description: string
): Preset {
  const segmentCount = Math.max(1, Math.round(style.shotsPerReel.median));
  const seconds = Math.max(0.4, style.shotSeconds.median);
  const transitionIn = presetTransition(style.transitions[0]?.value);
  const captionPosition = style.captions.band?.value;

  // The opening shot is the hook; the rest carry the body. Reels overwhelmingly
  // open with the claim, which is the one thing worth asserting from position.
  const segments = Array.from({ length: segmentCount }, (_, i) => ({
    durationSeconds: seconds,
    captionStyle: i === 0 ? ("hook" as const) : ("plain" as const),
    ...(captionPosition ? { captionPosition } : {}),
    // Every segment but the first is entered the way this creator usually
    // enters one; the reel's first frame isn't a transition.
    ...(i > 0 ? { transitionIn } : { transitionIn: "cut" as const }),
  }));

  return {
    name,
    description,
    output: { width: spec.width, height: spec.height, fps: spec.fps },
    segments,
  };
}
