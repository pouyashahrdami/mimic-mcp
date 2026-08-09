import { mkdir } from "node:fs/promises";
import path from "node:path";
import { concatRanges, probe } from "../ffmpeg.js";
import {
  buildKeepRanges,
  captionsFromWords,
  planCuts,
  remapWords,
  trimmedDuration,
  type CutPlanOptions,
  type CutSpan,
  type SpeechSegment,
  type TimedWord,
} from "../transcript-edit.js";
import { transcribe } from "../whisper.js";

export interface TranscriptEditResult {
  outPath: string | null;
  originalSeconds: number;
  editedSeconds: number;
  removedSeconds: number;
  /** Every cut, with what was said there — check this before rendering. */
  cuts: CutSpan[];
  /**
   * Captions taken from what was actually said, re-timed onto the edited clip.
   * Drop these into the recipe's segments — including `wordTimings`, which are
   * already segment-relative for karaoke.
   */
  captions: SpeechSegment[];
  notes: string[];
  nextStep: string;
}

/**
 * Edit talking-head footage by its transcript: cut the "um"s, cut a flubbed
 * sentence by quoting it, and get back captions that match the take rather
 * than a script retyped by hand.
 *
 * `dryRun` plans the cuts and captions without encoding anything — worth doing
 * first, since a cut list is much cheaper to read than a re-render is to redo.
 *
 * Output lands in `.mimic-mcp/<video-name>/<name>-edited.mp4` next to the cwd.
 */
export async function editByTranscript(
  videoPath: string,
  workDir: string,
  options: CutPlanOptions & { model?: string; dryRun?: boolean } = {}
): Promise<TranscriptEditResult> {
  const info = await probe(videoPath);
  if (!info.hasAudio) {
    throw new Error(
      "Video has no audio track, so there is no transcript to edit by. Use trim_silence " +
        "or cut by hand."
    );
  }

  const transcript = await transcribe(videoPath, options.model ?? "base");
  const words: TimedWord[] = transcript.segments.flatMap((s) => s.words);

  const notes: string[] = [];
  if (words.length === 0) {
    throw new Error(
      "The transcript came back with no word timings. Whisper needs --word_timestamps " +
        "support; check your whisper CLI version."
    );
  }

  const cuts = planCuts(words, options);
  if (cuts.length === 0) {
    notes.push(
      "Nothing matched — no disfluencies, and no phrase you asked for was said. " +
        "The clip is unchanged."
    );
  }

  const keeps = buildKeepRanges(cuts, info.durationSeconds);
  const editedSeconds = trimmedDuration(keeps);
  const captions = captionsFromWords(remapWords(keeps, words, cuts));

  if (options.removeCrutchWords) {
    notes.push(
      "Crutch words were cut. These are real words — read the `cuts` list and make sure " +
        "none of them were load-bearing."
    );
  }

  const base = path.basename(videoPath, path.extname(videoPath));
  const outDir = path.join(workDir, ".mimic-mcp", base);
  const outPath = path.join(outDir, `${base}-edited.mp4`);

  if (options.dryRun || cuts.length === 0) {
    return {
      outPath: null,
      originalSeconds: Math.round(info.durationSeconds * 100) / 100,
      editedSeconds: Math.round(editedSeconds * 100) / 100,
      removedSeconds: Math.round((info.durationSeconds - editedSeconds) * 100) / 100,
      cuts,
      captions,
      notes,
      nextStep:
        cuts.length === 0
          ? "No cuts to make. The captions above still come from the real take — use them."
          : `Planned ${cuts.length} cut(s) without encoding. Re-run with dry_run false to write the clip.`,
    };
  }

  await mkdir(outDir, { recursive: true });
  await concatRanges(videoPath, outPath, keeps);
  const edited = await probe(outPath);

  return {
    outPath,
    originalSeconds: Math.round(info.durationSeconds * 100) / 100,
    editedSeconds: Math.round(edited.durationSeconds * 100) / 100,
    removedSeconds: Math.round((info.durationSeconds - edited.durationSeconds) * 100) / 100,
    cuts,
    captions,
    notes,
    nextStep:
      `Cut ${cuts.length} span(s), ${Math.round((info.durationSeconds - edited.durationSeconds) * 100) / 100}s removed. ` +
      `Use ${outPath} as your footage, and the returned captions as your segments — they are ` +
      "already re-timed onto the edited clip.",
  };
}
