import { recipeSchema, type Recipe } from "./recipe.js";
import type { StyleSpec } from "./style-spec.js";

/**
 * Mechanical StyleSpec → recipe translation.
 *
 * Everything the analyzer MEASURED (cut times, transition kinds and durations,
 * in-shot zoom with fitted easing, caption band and size, beats) belongs in the
 * recipe as arithmetic, not as an agent's recollection of what it saw. This
 * module does that projection so the agent only has to supply content — the
 * script — and then edit judgment calls, instead of re-authoring timing it
 * already paid to measure.
 */

export interface DraftOptions {
  /** Caption lines in reel order — the content the projection can't measure. */
  script: string[];
  /** Absolute path to the user's footage, used as the reel-wide background. */
  footageVideo?: string;
  /** Footage length, so per-segment offsets are only set when they exist. */
  footageDurationSeconds?: number;
  /** CSS background for a from-scratch reel with no footage. */
  backgroundFill?: string;
  /** Absolute path to the soundtrack (e.g. from extract_music). */
  musicFile?: string;
  /** Nudge segment boundaries onto the measured beat grid. Default true. */
  snapToBeats?: boolean;
  /** How far a boundary may move to reach a beat. Default 0.12s. */
  beatToleranceSeconds?: number;
  /**
   * Where the subject sits in the FOOTAGE over each segment's span, measured by
   * suggest_framing and index-aligned to the shots. Aims cover-crops and
   * punch-ins at the subject instead of the middle of the frame.
   */
  framings?: (SegmentFraming | null)[];
}

export interface SegmentFraming {
  focusX: number;
  focusY: number;
  /** CSS object-position, or null when the measurement was too weak to use. */
  backgroundPosition: string | null;
}

export interface DraftResult {
  recipe: Recipe;
  /** Judgment calls the projection deliberately left to the agent. */
  notes: string[];
}

const DEFAULT_BEAT_TOLERANCE = 0.12;
/** Below this a segment reads as a flash, so never let snapping create one. */
const MIN_SEGMENT_SECONDS = 0.25;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Move each interior boundary to the nearest beat within tolerance. Boundaries
 * are snapped left-to-right and a snap is rejected when it would collapse the
 * segment on either side, so the result stays strictly increasing.
 */
export function snapBoundaries(
  bounds: number[],
  beats: number[],
  toleranceSeconds = DEFAULT_BEAT_TOLERANCE
): { bounds: number[]; snapped: number } {
  if (beats.length === 0 || bounds.length < 3) return { bounds: [...bounds], snapped: 0 };

  const out = [...bounds];
  let snapped = 0;
  for (let i = 1; i < out.length - 1; i++) {
    let best: number | null = null;
    for (const beat of beats) {
      const delta = Math.abs(beat - out[i]);
      if (delta > toleranceSeconds) continue;
      if (best === null || delta < Math.abs(best - out[i])) best = beat;
    }
    if (best === null || best === out[i]) continue;
    if (best - out[i - 1] < MIN_SEGMENT_SECONDS) continue;
    if (out[i + 1] - best < MIN_SEGMENT_SECONDS) continue;
    out[i] = best;
    snapped++;
  }
  return { bounds: out, snapped };
}

/** The caption event covering the most of [start, end], if any. */
function captionForSpan(
  captions: StyleSpec["captions"],
  start: number,
  end: number
): NonNullable<StyleSpec["captions"]>[number] | null {
  if (!captions) return null;
  let best: NonNullable<StyleSpec["captions"]>[number] | null = null;
  let bestOverlap = 0;
  for (const event of captions) {
    const overlap = Math.min(end, event.end) - Math.max(start, event.start);
    if (overlap > bestOverlap) {
      best = event;
      bestOverlap = overlap;
    }
  }
  // A caption grazing the shot for a few frames belongs to the neighbour.
  return bestOverlap >= Math.min(0.3, (end - start) / 2) ? best : null;
}

type CaptionEvent = NonNullable<StyleSpec["captions"]>[number];

/** What the reference's type says the caption style is. */
function captionStyleFor(event: CaptionEvent): "hook" | "tip" | "plain" {
  if (event.band === "bottom") return "tip";
  if (event.uppercase && event.lineHeight >= 0.055) return "hook";
  return "plain";
}

function transitionAt(
  spec: StyleSpec,
  time: number
): StyleSpec["transitions"][number] | null {
  let best: StyleSpec["transitions"][number] | null = null;
  let bestDelta = 0.25;
  for (const transition of spec.transitions) {
    const delta = Math.abs(transition.time - time);
    if (delta <= bestDelta) {
      best = transition;
      bestDelta = delta;
    }
  }
  return best;
}

export function draftRecipe(spec: StyleSpec, options: DraftOptions): DraftResult {
  if (spec.shots.length === 0) {
    throw new Error(
      "style spec has no shots — analyze_reference found no scene cuts, so there is " +
        "nothing to project a segment structure from"
    );
  }

  const notes: string[] = [];
  const script = options.script.map((line) => line.trim()).filter(Boolean);

  const rawBounds = [spec.shots[0].start, ...spec.shots.map((shot) => shot.end)];
  rawBounds[rawBounds.length - 1] = Math.min(
    rawBounds[rawBounds.length - 1],
    spec.durationSeconds
  );

  const { bounds, snapped } =
    options.snapToBeats === false
      ? { bounds: rawBounds, snapped: 0 }
      : snapBoundaries(rawBounds, spec.beats, options.beatToleranceSeconds);
  if (snapped > 0) {
    notes.push(
      `Snapped ${snapped} segment boundar${snapped === 1 ? "y" : "ies"} onto the ` +
        `measured beat grid${spec.bpm ? ` (${Math.round(spec.bpm)} BPM)` : ""}.`
    );
  }

  // A shot only gets a script line if the reference showed text over it; with no
  // OCR track (non-macOS) every shot is a candidate.
  const events = spec.shots.map((_, i) =>
    captionForSpan(spec.captions, bounds[i], bounds[i + 1])
  );
  const slots = spec.captions
    ? events.flatMap((event, i) => (event ? [i] : []))
    : spec.shots.map((_, i) => i);
  const spare = spec.shots.flatMap((_, i) => (slots.includes(i) ? [] : [i]));
  const order = [...slots, ...spare];

  const captions = new Array<string>(spec.shots.length).fill("");
  script.slice(0, order.length).forEach((line, i) => {
    captions[order[i]] = line;
  });

  const perSegmentFootage =
    options.footageVideo != null &&
    options.footageDurationSeconds != null &&
    options.footageDurationSeconds >= bounds[bounds.length - 1];

  const pans: number[] = [];
  const segments = spec.shots.map((shot, i) => {
    const start = round2(bounds[i]);
    const end = round2(bounds[i + 1]);
    const event = events[i];
    const transition = i > 0 ? transitionAt(spec, bounds[i]) : null;
    const motion = shot.motion;
    // Only footage segments get aimed; a fill or scene has no subject to find.
    const framing = options.footageVideo ? (options.framings?.[i] ?? null) : null;

    if (motion && (motion.type === "pan" || motion.type === "zoom+pan")) pans.push(i);

    return {
      start,
      end,
      caption: captions[i],
      ...(event
        ? {
            captionStyle: captionStyleFor(event),
            captionPosition: event.band,
            captionSize: Math.round(event.lineHeight * spec.height),
          }
        : {}),
      ...(perSegmentFootage ? { backgroundStart: start } : {}),
      ...(framing?.backgroundPosition
        ? { backgroundPosition: framing.backgroundPosition }
        : {}),
      ...(transition && transition.kind !== "cut"
        ? {
            videoTransitionIn: {
              kind: transition.kind,
              durationSeconds: Math.min(2, round2(transition.durationSeconds)),
              ...(transition.direction ? { direction: transition.direction } : {}),
            },
          }
        : {}),
      ...(motion && (motion.type === "zoom" || motion.type === "zoom+pan")
        ? {
            zoom: {
              from: 1,
              to: round2(motion.scaleTo),
              ...(motion.easing ? { easing: motion.easing } : {}),
              // Punch in toward the subject, not the middle of the frame.
              ...(framing ? { focusX: framing.focusX, focusY: framing.focusY } : {}),
            },
          }
        : {}),
    };
  });

  const fill =
    options.backgroundFill ?? (options.footageVideo ? undefined : "#0b0b0f");
  if (!options.footageVideo && !options.backgroundFill) {
    notes.push(
      "No footage and no fill given — every segment falls back to a flat dark canvas. " +
        "Replace with backgroundFill / backgroundImage / scene per segment."
    );
  }

  const emptyCaptions = captions.flatMap((caption, i) => (caption ? [] : [i]));
  if (emptyCaptions.length > 0) {
    notes.push(
      `Segments ${emptyCaptions.join(", ")} have no caption — the reference showed no ` +
        "text there, or the script ran out. Fill them in or leave them clean."
    );
  }
  if (script.length > order.length) {
    notes.push(
      `${script.length - order.length} script line(s) had no shot to land on. Either ` +
        "merge them into neighbouring captions or add segments."
    );
  }
  if (pans.length > 0) {
    notes.push(
      `Segments ${pans.join(", ")} pan in the reference; the recipe only expresses zoom. ` +
        "Approximate with zoom focusX/focusY, or leave them static."
    );
  }
  if (options.framings && options.footageVideo) {
    const aimed = segments.filter((s) => "backgroundPosition" in s).length;
    const unaimed = segments.length - aimed;
    notes.push(
      `Framing measured from your footage: ${aimed} segment(s) aimed at the subject` +
        (unaimed > 0
          ? `, ${unaimed} left centred because no clear subject was found.`
          : ".")
    );
  }
  if (!perSegmentFootage && segments.some((s) => "videoTransitionIn" in s)) {
    notes.push(
      "Footage transitions need two clips to blend — set backgroundStart (or " +
        "backgroundVideo) per segment, or the non-dip transitions will render as cuts."
    );
  }
  if (spec.captions === null) {
    notes.push(
      "No OCR caption track in the spec (non-macOS), so caption position, size and style " +
        "are defaults rather than measured. Set them from the reference frames."
    );
  }

  const recipe = recipeSchema.parse({
    output: {
      width: spec.width,
      height: spec.height,
      fps: spec.fps,
      durationSeconds: round2(spec.durationSeconds),
    },
    background: {
      ...(options.footageVideo ? { video: options.footageVideo } : {}),
      ...(fill ? { fill } : {}),
      fit: "cover",
      muted: true,
    },
    ...(options.musicFile ? { music: { file: options.musicFile, volume: 0.8 } } : {}),
    segments,
  });

  return { recipe, notes };
}
