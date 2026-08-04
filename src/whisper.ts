import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

// Both CLIs emit the same JSON shape (segments with optional per-word timings).
// whisper-ctranslate2 is the light one (faster-whisper, no torch); plain
// `whisper` is OpenAI's reference CLI. We use whichever is installed.
const WHISPER_BINARIES = ["whisper-ctranslate2", "whisper"] as const;

export class WhisperMissingError extends Error {
  constructor() {
    super(
      "No whisper CLI found on PATH. Install one first, e.g. " +
        "`uv tool install whisper-ctranslate2` (light, no torch) or `pip install openai-whisper`."
    );
  }
}

export interface TranscriptWord {
  start: number;
  end: number;
  word: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
}

export interface Transcript {
  language?: string;
  text: string;
  segments: TranscriptSegment[];
}

async function whichWhisper(): Promise<string> {
  for (const bin of WHISPER_BINARIES) {
    try {
      await run(bin, ["--help"], { maxBuffer: MAX_BUFFER });
      return bin;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      // --help exiting non-zero still proves the binary exists.
      return bin;
    }
  }
  throw new WhisperMissingError();
}

/**
 * Transcribe a media file with word-level timestamps via a local whisper CLI.
 * `model` trades speed for accuracy: "tiny"/"base" are fast, "small"/"medium"
 * are slower but sharper. Returns the parsed transcript.
 */
export async function transcribe(
  mediaPath: string,
  model = "base"
): Promise<Transcript> {
  const bin = await whichWhisper();
  const outDir = await mkdtemp(path.join(tmpdir(), "reels-whisper-"));

  try {
    await run(
      bin,
      [
        mediaPath,
        "--model", model,
        "--output_format", "json",
        "--word_timestamps", "True",
        "--output_dir", outDir,
      ],
      { maxBuffer: MAX_BUFFER }
    );

    const base = path.basename(mediaPath, path.extname(mediaPath));
    const raw = JSON.parse(await readFile(path.join(outDir, `${base}.json`), "utf8"));

    const segments: TranscriptSegment[] = (raw.segments ?? []).map(
      (s: {
        start: number;
        end: number;
        text: string;
        words?: { start: number; end: number; word: string }[];
      }) => ({
        start: Math.round(s.start * 100) / 100,
        end: Math.round(s.end * 100) / 100,
        text: String(s.text).trim(),
        words: (s.words ?? []).map((w) => ({
          start: Math.round(w.start * 100) / 100,
          end: Math.round(w.end * 100) / 100,
          word: String(w.word).trim(),
        })),
      })
    );

    return {
      language: raw.language,
      text: String(raw.text ?? "").trim(),
      segments,
    };
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}
