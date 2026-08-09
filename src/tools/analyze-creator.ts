import {
  presetFromCreator,
  summarizeCreator,
  type CreatorStyle,
} from "../creator-style.js";
import { writePreset } from "../presets.js";
import type { StyleSpec } from "../style-spec.js";
import { analyzeReference } from "./analyze-reference.js";

/** Analyzing a reel is a full decode; a few at a time keeps the machine usable. */
const ANALYSIS_CONCURRENCY = 2;

/** Past this the marginal reel teaches almost nothing and costs a full decode. */
const MAX_REELS = 12;

export interface CreatorAnalysis {
  style: CreatorStyle;
  /** Written only when `presetName` was given. */
  preset: { name: string; file: string } | null;
  specFiles: string[];
  instructions: string;
}

/**
 * Learn a style from several of one creator's reels instead of from one.
 *
 * One reference can't tell you which of its choices were the style and which
 * were that video's subject. Analyzing a body of work separates them: what
 * recurs is the style, what varies is the range they work in.
 */
export async function analyzeCreator(
  videos: string[],
  workDir: string,
  { presetName, presetDescription }: { presetName?: string; presetDescription?: string } = {}
): Promise<CreatorAnalysis> {
  if (videos.length === 0) throw new Error("no reels given");
  if (videos.length > MAX_REELS) {
    throw new Error(
      `${videos.length} reels is more than this needs — pass at most ${MAX_REELS}. ` +
        "Habits show up well before then, and each reel costs a full decode."
    );
  }

  // Sequential in small batches: analyzeReference already fans out internally,
  // so running many at once just contends for the same disk.
  const specs: StyleSpec[] = [];
  const specFiles: string[] = [];
  for (let i = 0; i < videos.length; i += ANALYSIS_CONCURRENCY) {
    const batch = videos.slice(i, i + ANALYSIS_CONCURRENCY);
    const analyses = await Promise.all(batch.map((v) => analyzeReference(v, workDir)));
    for (const analysis of analyses) {
      specs.push(analysis.styleSpec);
      specFiles.push(analysis.styleSpecFile);
    }
  }

  const style = summarizeCreator(specs);

  let preset: { name: string; file: string } | null = null;
  if (presetName) {
    const reference = specs.find((s) => s.shots.length > 0) as StyleSpec;
    preset = await writePreset(
      presetFromCreator(
        style,
        reference,
        presetName,
        presetDescription ??
          `Learned from ${style.reels} reels: ${style.shotSeconds.median}s median shots, ` +
            `${style.transitions[0]?.value ?? "cut"} transitions.`
      ),
      workDir
    );
  }

  return {
    style,
    preset,
    specFiles,
    instructions:
      `Measured ${style.reels} reel(s) from one creator. Read the DISTRIBUTIONS, not just the ` +
      "medians: `shotSeconds.p25`..`p75` is the range they actually cut in, and `consistency` " +
      `is ${style.consistency} — how tightly their reels agree on a rhythm. Low consistency ` +
      "means these reels are several styles and a single preset will average them into " +
      "something the creator never made; analyze a tighter set instead. " +
      (preset
        ? `A preset built from the middle of these was written to ${preset.file}.`
        : "Pass `preset_name` to save a reusable preset built from the middle of these.") +
      " The preset carries rhythm, transitions and caption band — the look. Content, footage " +
      "and music are still yours to write.",
  };
}
