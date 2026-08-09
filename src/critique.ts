/**
 * Score a reel against itself — no reference required.
 *
 * `spec-diff.ts` answers "does this match the reference?", which is the wrong
 * question when there ISN'T one: a from-scratch reel gets no automated feedback
 * at all today. These are the failures that don't need a reference to spot,
 * because they're about whether a human can read and follow the thing —
 * captions that flash past faster than anyone reads, a hook that starts on an
 * empty frame, text with nothing separating it from the footage, every segment
 * the same length.
 *
 * Deliberately heuristic. Each issue names the recipe field to change and says
 * what it measured, so the agent can disagree with a number it can see.
 *
 * Pure: takes a recipe, returns findings.
 */

import type { Recipe } from "./recipe.js";

export type CritiqueSeverity = "high" | "medium" | "low";

export interface CritiqueIssue {
  severity: CritiqueSeverity;
  /** Which check fired, for grouping. */
  kind: string;
  /** Segment this is about, or null when it's about the reel as a whole. */
  segment: number | null;
  message: string;
  /** The recipe field to change. */
  field: string;
}

export interface Critique {
  /** 0..100. 100 = nothing measurably wrong with how it reads. */
  score: number;
  issues: CritiqueIssue[];
  /** What was measured, so the agent can argue with the verdict. */
  measurements: {
    durationSeconds: number;
    segments: number;
    meanSegmentSeconds: number;
    /** Standard deviation of segment length — 0 means metronomic. */
    segmentLengthSpread: number;
    /** Fastest caption in the reel, in words per second. */
    peakWordsPerSecond: number;
    /** Seconds with neither a caption nor narration. */
    silentSeconds: number;
  };
}

/**
 * Burned-in reel captions are read at a glance, not studied — this is the
 * comfortable ceiling. Subtitle guidelines put sustained reading around 3
 * words/second; short bursts of large on-screen text run a little faster.
 */
const MAX_WORDS_PER_SECOND = 4.5;
/** Under this, a caption is a flash — nobody finishes it. */
const HARD_WORDS_PER_SECOND = 7;
/** A caption alone on screen longer than this has stopped saying anything. */
const STALE_CAPTION_SECONDS = 6;
/** The window that decides whether anyone keeps watching. */
const HOOK_SECONDS = 1.5;
/** Below this spread every segment is the same length and the reel drones. */
const MIN_LENGTH_SPREAD = 0.25;
/** A short-form shot held longer than this needs a reason. */
const LONG_SEGMENT_SECONDS = 6;
/** Past this, it isn't short-form any more. */
const LONG_REEL_SECONDS = 90;

const PENALTIES: Record<CritiqueSeverity, number> = {
  high: 12,
  medium: 6,
  low: 3,
};

function wordCount(caption: string): number {
  return caption.trim().split(/\s+/).filter(Boolean).length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Seconds of the reel with neither a caption on screen nor a voiceover under it. */
function silentSeconds(recipe: Recipe): number {
  const covered = recipe.segments
    .filter((s) => wordCount(s.caption) > 0)
    .map((s) => ({ start: s.start, end: s.end }));

  if (recipe.voiceover) {
    const start = recipe.voiceover.startSeconds ?? 0;
    const end = recipe.voiceover.durationSeconds
      ? start + recipe.voiceover.durationSeconds
      : recipe.output.durationSeconds;
    covered.push({ start, end });
  }

  const merged = covered
    .sort((a, b) => a.start - b.start)
    .reduce<{ start: number; end: number }[]>((acc, span) => {
      const last = acc[acc.length - 1];
      if (last && span.start <= last.end) {
        last.end = Math.max(last.end, span.end);
        return acc;
      }
      acc.push({ ...span });
      return acc;
    }, []);

  const total = merged.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
  return Math.max(0, Math.round((recipe.output.durationSeconds - total) * 100) / 100);
}

/**
 * Does anything separate this caption's letters from whatever is behind them?
 * White text on unknown footage is legible until the shot turns pale, and the
 * recipe can't know what the footage looks like — but it does know whether the
 * caption brought its own contrast.
 */
function hasSeparation(segment: Recipe["segments"][number]): boolean {
  if (segment.captionBackground) return true;
  if (segment.captionOutline && segment.captionOutline.widthPx > 0) return true;
  // The built-in "tip" look ships a background pill of its own.
  return segment.captionStyle === "tip";
}

export function critiqueRecipe(recipe: Recipe): Critique {
  const issues: CritiqueIssue[] = [];
  const { segments } = recipe;
  const lengths = segments.map((s) => s.end - s.start);

  let peakWordsPerSecond = 0;

  segments.forEach((segment, index) => {
    const seconds = segment.end - segment.start;
    const words = wordCount(segment.caption);

    if (words > 0) {
      const wps = words / seconds;
      peakWordsPerSecond = Math.max(peakWordsPerSecond, wps);

      if (wps > HARD_WORDS_PER_SECOND) {
        issues.push({
          severity: "high",
          kind: "caption-too-fast",
          segment: index,
          message:
            `Segment ${index} shows ${words} words in ${Math.round(seconds * 100) / 100}s ` +
            `(${Math.round(wps * 10) / 10} words/sec). Nobody finishes reading that — ` +
            `it needs about ${Math.round((words / MAX_WORDS_PER_SECOND) * 10) / 10}s.`,
          field: "segments[].end (or shorten the caption)",
        });
      } else if (wps > MAX_WORDS_PER_SECOND) {
        issues.push({
          severity: "medium",
          kind: "caption-rushed",
          segment: index,
          message:
            `Segment ${index} runs ${Math.round(wps * 10) / 10} words/sec, above the ` +
            `${MAX_WORDS_PER_SECOND} that reads comfortably at a glance.`,
          field: "segments[].end (or shorten the caption)",
        });
      }

      if (seconds > STALE_CAPTION_SECONDS) {
        issues.push({
          severity: "low",
          kind: "caption-stale",
          segment: index,
          message:
            `Segment ${index} holds the same caption for ${Math.round(seconds * 10) / 10}s. ` +
            "Long-held text stops being read and starts being scenery.",
          field: "segments[].end",
        });
      }

      if (!hasSeparation(segment)) {
        issues.push({
          severity: "medium",
          kind: "caption-no-separation",
          segment: index,
          message:
            `Segment ${index}'s caption has no outline and no background pill, so it is ` +
            "only readable while the footage behind it stays dark.",
          field: "segments[].captionOutline / segments[].captionBackground",
        });
      }
    }

    if (seconds > LONG_SEGMENT_SECONDS) {
      issues.push({
        severity: "low",
        kind: "segment-long",
        segment: index,
        message:
          `Segment ${index} holds for ${Math.round(seconds * 10) / 10}s without a cut. ` +
          "Short-form attention rarely survives that on one shot.",
        field: "segments[].end",
      });
    }
  });

  // The hook: something has to be on screen in the first moment, or the
  // scroll happens before the reel has said anything.
  const opening = segments.find((s) => s.start < HOOK_SECONDS);
  if (!opening || wordCount(opening.caption) === 0) {
    issues.push({
      severity: "high",
      kind: "no-hook",
      segment: opening ? segments.indexOf(opening) : null,
      message:
        `Nothing is said in the first ${HOOK_SECONDS}s. That window decides whether ` +
        "anyone watches the rest — open on the claim, not on a title card.",
      field: "segments[0].caption",
    });
  } else if (opening.start > 0.3) {
    issues.push({
      severity: "medium",
      kind: "late-start",
      segment: 0,
      message: `The first caption doesn't appear until ${opening.start}s. Open sooner.`,
      field: "segments[0].start",
    });
  }

  const spread = standardDeviation(lengths);
  if (segments.length >= 3 && spread < MIN_LENGTH_SPREAD) {
    issues.push({
      severity: "low",
      kind: "metronomic",
      segment: null,
      message:
        `Every segment is about the same length (spread ${Math.round(spread * 100) / 100}s). ` +
        "Even pacing reads as a slideshow — vary the holds.",
      field: "segments[].start / segments[].end",
    });
  }

  const dead = silentSeconds(recipe);
  if (dead > 1.5) {
    issues.push({
      severity: dead > 4 ? "medium" : "low",
      kind: "dead-air",
      segment: null,
      message:
        `${dead}s of the reel has neither a caption nor narration. Empty frames are where ` +
        "people leave.",
      field: "segments[].caption / voiceover",
    });
  }

  if (recipe.output.durationSeconds > LONG_REEL_SECONDS) {
    issues.push({
      severity: "medium",
      kind: "reel-long",
      segment: null,
      message:
        `${recipe.output.durationSeconds}s is past what short-form holds. Cut it down or ` +
        "split it into parts.",
      field: "output.durationSeconds",
    });
  }

  if (recipe.output.height < recipe.output.width) {
    issues.push({
      severity: "medium",
      kind: "not-vertical",
      segment: null,
      message:
        `The output is landscape (${recipe.output.width}x${recipe.output.height}). Reels, ` +
        "Shorts and TikTok are vertical — use export_variants if you need both.",
      field: "output.width / output.height",
    });
  }

  const penalty = issues.reduce((sum, issue) => sum + PENALTIES[issue.severity], 0);
  const order: Record<CritiqueSeverity, number> = { high: 0, medium: 1, low: 2 };

  return {
    score: Math.max(0, 100 - penalty),
    issues: issues.sort((a, b) => order[a.severity] - order[b.severity]),
    measurements: {
      durationSeconds: recipe.output.durationSeconds,
      segments: segments.length,
      meanSegmentSeconds:
        lengths.length > 0
          ? Math.round((lengths.reduce((s, v) => s + v, 0) / lengths.length) * 100) / 100
          : 0,
      segmentLengthSpread: Math.round(spread * 100) / 100,
      peakWordsPerSecond: Math.round(peakWordsPerSecond * 10) / 10,
      silentSeconds: dead,
    },
  };
}
