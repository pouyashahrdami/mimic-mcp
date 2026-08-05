import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

// Modern aubio ships a single `aubio` CLI with subcommands; older installs
// have split binaries like `aubiotrack`. Either gives real tempo-model beat
// tracking — a big step up from RMS onset detection. Same optional-CLI
// pattern as whisper.ts: use it when installed, fall back cleanly when not.
const AUBIO_BINARIES = ["aubio", "aubiotrack"] as const;

async function whichAubio(): Promise<(typeof AUBIO_BINARIES)[number] | null> {
  for (const bin of AUBIO_BINARIES) {
    try {
      await run(bin, ["--help"], { maxBuffer: MAX_BUFFER });
      return bin;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      // --help exiting non-zero still proves the binary exists.
      return bin;
    }
  }
  return null;
}

/** aubio prints one beat timestamp (seconds) per line. */
export function parseAubioBeats(stdout: string): number[] {
  const beats: number[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const t = Number(trimmed);
    if (Number.isFinite(t) && t >= 0) beats.push(Math.round(t * 100) / 100);
  }
  return beats;
}

/**
 * Beat timestamps from aubio's beat tracker, or null when no aubio CLI is
 * installed (`brew install aubio` / `uv tool install aubio`). The media is
 * bounced to a mono wav first because aubio builds often can't demux video
 * containers.
 */
export async function tryAubioBeats(mediaPath: string): Promise<number[] | null> {
  const bin = await whichAubio();
  if (!bin) return null;

  const dir = await mkdtemp(path.join(tmpdir(), "mimic-aubio-"));
  const wav = path.join(dir, "audio.wav");
  try {
    await run(
      "ffmpeg",
      ["-y", "-i", mediaPath, "-vn", "-ac", "1", "-ar", "44100", wav],
      { maxBuffer: MAX_BUFFER }
    );
    const args = bin === "aubio" ? ["beat", "-i", wav] : ["-i", wav];
    const { stdout } = await run(bin, args, { maxBuffer: MAX_BUFFER });
    return parseAubioBeats(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
