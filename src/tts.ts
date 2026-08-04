import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { mediaDuration } from "./ffmpeg.js";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export class SayMissingError extends Error {
  constructor() {
    super(
      "macOS `say` not found. Voiceover generation currently uses the built-in macOS TTS, " +
        "so it needs macOS. On other platforms, supply your own narration audio instead."
    );
  }
}

export interface Voiceover {
  file: string;
  durationSeconds: number;
  voice?: string;
}

/**
 * Synthesize a voiceover from text using macOS `say`, transcoded to m4a so it
 * slots straight into a recipe as an audio track. `voice` picks a system voice
 * (e.g. "Samantha", "Daniel"); `rate` is words-per-minute.
 */
export async function synthesizeVoiceover(
  text: string,
  outPath: string,
  options: { voice?: string; rate?: number } = {}
): Promise<Voiceover> {
  const tmp = await mkdtemp(path.join(tmpdir(), "reels-tts-"));
  const aiff = path.join(tmp, "voice.aiff");

  try {
    const args = ["-o", aiff];
    if (options.voice) args.push("-v", options.voice);
    if (options.rate) args.push("-r", String(options.rate));
    args.push(text);

    try {
      await run("say", args, { maxBuffer: MAX_BUFFER });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new SayMissingError();
      throw err;
    }

    // Transcode AIFF -> AAC/m4a for a predictable, small container.
    await run(
      "ffmpeg",
      ["-y", "-i", aiff, "-c:a", "aac", "-b:a", "160k", outPath],
      { maxBuffer: MAX_BUFFER }
    );

    const durationSeconds = await mediaDuration(outPath);
    return {
      file: outPath,
      durationSeconds: Math.round(durationSeconds * 100) / 100,
      voice: options.voice,
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
