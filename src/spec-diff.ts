import type { MeasuredTransition, StyleSpec } from "./style-spec.js";

/**
 * Numeric comparison of two measured StyleSpecs — the reference reel's and
 * the render's. Because both sides come from the same analyzer, "does the
 * render match the reference" stops being a visual judgment call and becomes
 * a list of measured deviations, each pointing at the recipe field to fix.
 */

export interface CutMatch {
  referenceTime: number;
  renderTime: number;
  /** Positive = the render's cut lands late. */
  errorSeconds: number;
}

export interface TransitionMatch {
  time: number;
  referenceKind: MeasuredTransition["kind"];
  renderKind: MeasuredTransition["kind"] | "cut";
  match: boolean;
}

export interface CaptionMatch {
  referenceText: string;
  renderText: string;
  /** Positive = the render's caption appears late. */
  startErrorSeconds: number;
  bandMatch: boolean;
  /** Render line height / reference line height; 1 = same visual size. */
  sizeRatio: number;
}

export interface SpecDiff {
  /** 0..100. 100 = every measured dimension matches. */
  score: number;
  cuts: {
    matched: CutMatch[];
    missedReference: number[];
    extraRender: number[];
    meanAbsErrorSeconds: number | null;
  };
  transitions: TransitionMatch[];
  captions: CaptionMatch[];
  /** Actionable, human-readable deviations, worst first. */
  issues: string[];
}

const CUT_TOLERANCE = 0.35;

function matchTimes(
  reference: number[],
  render: number[],
  tolerance: number
): { matched: CutMatch[]; missedReference: number[]; extraRender: number[] } {
  const matched: CutMatch[] = [];
  const usedRender = new Set<number>();
  const missedReference: number[] = [];
  for (const refT of reference) {
    let best = -1;
    let bestErr = Infinity;
    for (let i = 0; i < render.length; i++) {
      if (usedRender.has(i)) continue;
      const err = Math.abs(render[i] - refT);
      if (err < bestErr) {
        bestErr = err;
        best = i;
      }
    }
    if (best >= 0 && bestErr <= tolerance) {
      usedRender.add(best);
      matched.push({
        referenceTime: refT,
        renderTime: render[best],
        errorSeconds: Math.round((render[best] - refT) * 100) / 100,
      });
    } else {
      missedReference.push(refT);
    }
  }
  const extraRender = render.filter((_, i) => !usedRender.has(i));
  return { matched, missedReference, extraRender };
}

/** Overlap in seconds between two [start, end) ranges. */
const overlap = (
  a: { start: number; end: number },
  b: { start: number; end: number }
): number => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

export function diffSpecs(reference: StyleSpec, render: StyleSpec): SpecDiff {
  const issues: string[] = [];
  let penalty = 0;

  // Map reference times onto the render's timeline so a 12s recreation of a
  // 30s reel is judged on proportional rhythm, not absolute seconds.
  const scale =
    reference.durationSeconds > 0
      ? render.durationSeconds / reference.durationSeconds
      : 1;
  const scaleTime = (t: number): number => Math.round(t * scale * 100) / 100;

  // --- Cuts ---
  const refCutTimes = reference.transitions.map((t) => scaleTime(t.time));
  const renderCutTimes = render.transitions.map((t) => t.time);
  const cuts = matchTimes(refCutTimes, renderCutTimes, CUT_TOLERANCE);
  const meanAbsErrorSeconds =
    cuts.matched.length > 0
      ? Math.round(
          (cuts.matched.reduce((s, m) => s + Math.abs(m.errorSeconds), 0) /
            cuts.matched.length) *
            100
        ) / 100
      : null;
  for (const t of cuts.missedReference) {
    penalty += 8;
    issues.push(
      `reference has a cut at ${t}s (render timeline) with no matching cut in the render — ` +
        "add a segment boundary there"
    );
  }
  for (const t of cuts.extraRender) {
    penalty += 4;
    issues.push(`render has an extra cut at ${t}s the reference doesn't have`);
  }
  for (const m of cuts.matched) {
    if (Math.abs(m.errorSeconds) > 0.15) {
      penalty += 3;
      issues.push(
        `cut at ${m.referenceTime}s lands ${Math.abs(m.errorSeconds)}s ` +
          `${m.errorSeconds > 0 ? "late" : "early"} in the render — nudge the segment boundary`
      );
    }
  }

  // --- Transition kinds, judged on the matched pairs ---
  const transitions: TransitionMatch[] = [];
  for (const m of cuts.matched) {
    const ref = reference.transitions.find((t) => scaleTime(t.time) === m.referenceTime);
    const ren = render.transitions.find((t) => t.time === m.renderTime);
    if (!ref) continue;
    const renderKind = ren?.kind ?? "cut";
    const match = ref.kind === renderKind;
    transitions.push({ time: m.referenceTime, referenceKind: ref.kind, renderKind, match });
    if (!match) {
      penalty += 6;
      issues.push(
        `transition at ${m.referenceTime}s: reference is a ${ref.kind}, render is a ` +
          `${renderKind} — set that segment's videoTransitionIn to "${ref.kind}"`
      );
    }
  }

  // --- Motion, shot-by-shot via time overlap ---
  for (const refShot of reference.shots) {
    if (!refShot.motion || refShot.motion.type === "static") continue;
    const scaled = {
      start: refShot.start * scale,
      end: refShot.end * scale,
    };
    // Only shots that actually overlap the reference shot's window count as
    // a match — otherwise a distant shot's motion masks a missing zoom.
    const renderShot = render.shots
      .filter((s) => s.motion && overlap(s, scaled) > 0)
      .reduce(
        (best, s) => (!best || overlap(s, scaled) > overlap(best, scaled) ? s : best),
        undefined as (typeof render.shots)[number] | undefined
      );
    const renderMotion = renderShot?.motion;
    if (!renderMotion || renderMotion.type === "static") {
      penalty += 6;
      const m = refShot.motion;
      issues.push(
        `shot ${refShot.start}-${refShot.end}s: reference has ${m.type} ` +
          `(scale ${m.scaleTo}${m.easing ? `, ${m.easing}` : ""}) but the render is static — ` +
          "add a zoom to the matching segment"
      );
    } else if (
      refShot.motion.type.includes("zoom") &&
      Math.abs(renderMotion.scaleTo - refShot.motion.scaleTo) > 0.05
    ) {
      penalty += 3;
      issues.push(
        `shot ${refShot.start}-${refShot.end}s: zoom reaches ${renderMotion.scaleTo}x in the ` +
          `render vs ${refShot.motion.scaleTo}x in the reference — adjust zoom.to`
      );
    }
  }

  // --- Captions, matched by timing overlap (texts intentionally differ) ---
  const captionMatches: CaptionMatch[] = [];
  if (reference.captions && render.captions) {
    const usedRender = new Set<number>();
    for (const refCap of reference.captions) {
      const scaled = { start: refCap.start * scale, end: refCap.end * scale };
      let best = -1;
      let bestOverlap = 0;
      for (let i = 0; i < render.captions.length; i++) {
        if (usedRender.has(i)) continue;
        const o = overlap(render.captions[i], scaled);
        if (o > bestOverlap) {
          bestOverlap = o;
          best = i;
        }
      }
      if (best < 0) {
        penalty += 6;
        issues.push(
          `reference caption "${refCap.text}" (${refCap.start}-${refCap.end}s) has no ` +
            "on-screen text in the render at that time — add/retime a segment caption"
        );
        continue;
      }
      usedRender.add(best);
      const renCap = render.captions[best];
      const startError = Math.round((renCap.start - scaled.start) * 100) / 100;
      const sizeRatio =
        refCap.lineHeight > 0
          ? Math.round((renCap.lineHeight / refCap.lineHeight) * 100) / 100
          : 1;
      captionMatches.push({
        referenceText: refCap.text,
        renderText: renCap.text,
        startErrorSeconds: startError,
        bandMatch: refCap.band === renCap.band,
        sizeRatio,
      });
      if (Math.abs(startError) > 0.3) {
        penalty += 3;
        issues.push(
          `caption "${renCap.text}" appears ${Math.abs(startError)}s ` +
            `${startError > 0 ? "late" : "early"} vs the reference — retime its segment`
        );
      }
      if (refCap.band !== renCap.band) {
        penalty += 4;
        issues.push(
          `caption "${renCap.text}" sits in the ${renCap.band} band but the reference's ` +
            `sits ${refCap.band} — move it (captionStyle or template layout)`
        );
      }
      if (sizeRatio < 0.75 || sizeRatio > 1.35) {
        penalty += 3;
        issues.push(
          `caption "${renCap.text}" renders at ${Math.round(sizeRatio * 100)}% of the ` +
            "reference's text size — adjust captionSize"
        );
      }
    }
  }

  return {
    score: Math.max(0, 100 - penalty),
    cuts: { ...cuts, meanAbsErrorSeconds },
    transitions,
    captions: captionMatches,
    issues,
  };
}
