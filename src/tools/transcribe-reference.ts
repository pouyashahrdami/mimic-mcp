import { transcribe } from "../whisper.js";

export interface TranscribedSegment {
  start: number;
  end: number;
  text: string;
  /** Word start times relative to THIS segment's start — drop straight into a
   *  recipe segment's `wordTimings` for karaoke captions synced to the voice. */
  wordTimings: number[];
}

export interface ReferenceTranscript {
  video: string;
  language?: string;
  text: string;
  segments: TranscribedSegment[];
  notes: string[];
}

/**
 * Transcribe a reference reel so the agent can see its *script* — the spoken
 * hook, build and payoff with timings — not just its frames. Each segment's
 * word offsets are pre-shifted to be segment-relative so they can feed karaoke
 * captions directly.
 */
export async function transcribeReference(
  videoPath: string,
  model = "base"
): Promise<ReferenceTranscript> {
  const transcript = await transcribe(videoPath, model);

  const segments: TranscribedSegment[] = transcript.segments.map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text,
    wordTimings: s.words.map((w) => Math.round((w.start - s.start) * 100) / 100),
  }));

  const notes: string[] = [];
  if (segments.length === 0) {
    notes.push("No speech detected — the reference may be music-only or instrumental.");
  } else {
    notes.push(
      "Each segment is a spoken phrase with its timing. Mirror this script structure " +
        "(hook → build → payoff) with your own words, and reuse a segment's wordTimings " +
        "on a karaoke caption to sync the highlight to the voice."
    );
  }

  return {
    video: videoPath,
    language: transcript.language,
    text: transcript.text,
    segments,
    notes,
  };
}
