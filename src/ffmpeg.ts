import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// ffmpeg writes filter/progress output to stderr, so we keep both streams.
const MAX_BUFFER = 64 * 1024 * 1024;

export class FfmpegMissingError extends Error {
  constructor(binary: string) {
    super(
      `${binary} not found on PATH. Install it first (macOS: \`brew install ffmpeg\`).`
    );
  }
}

async function exec(binary: "ffmpeg" | "ffprobe", args: string[]) {
  try {
    return await run(binary, args, { maxBuffer: MAX_BUFFER });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FfmpegMissingError(binary);
    }
    throw err;
  }
}

export interface VideoInfo {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  audioCodec?: string;
}

export async function probe(videoPath: string): Promise<VideoInfo> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    videoPath,
  ]);

  const data = JSON.parse(stdout);
  const video = data.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
  if (!video) {
    throw new Error(`No video stream found in ${videoPath}`);
  }
  const audio = data.streams?.find((s: { codec_type: string }) => s.codec_type === "audio");

  // avg_frame_rate comes as a fraction like "30000/1001"
  const [num, den] = String(video.avg_frame_rate ?? "30/1").split("/").map(Number);
  const fps = den ? num / den : 30;

  return {
    durationSeconds: Number(data.format?.duration ?? 0),
    width: Number(video.width),
    height: Number(video.height),
    fps: Math.round(fps * 100) / 100,
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name,
  };
}

/**
 * Detect hard cuts by scoring frame-to-frame difference. Returns timestamps
 * (seconds) where a new shot starts. `threshold` is ffmpeg's scene score
 * (0..1); 0.3 catches typical hard cuts without firing on fast motion.
 */
export async function detectSceneCuts(
  videoPath: string,
  threshold = 0.3
): Promise<number[]> {
  const { stderr } = await exec("ffmpeg", [
    "-i", videoPath,
    "-vf", `select='gt(scene,${threshold})',showinfo`,
    "-f", "null",
    "-",
  ]);

  const cuts: number[] = [];
  for (const match of stderr.matchAll(/pts_time:([\d.]+)/g)) {
    cuts.push(Number(match[1]));
  }
  return cuts;
}

export async function extractFrame(
  videoPath: string,
  atSeconds: number,
  outPath: string
): Promise<void> {
  await exec("ffmpeg", [
    "-y",
    "-ss", String(atSeconds),
    "-i", videoPath,
    "-frames:v", "1",
    "-q:v", "3",
    outPath,
  ]);
}

/** Extract the audio track, re-encoded to AAC so the container is predictable. */
export async function extractAudio(
  videoPath: string,
  outPath: string
): Promise<void> {
  await exec("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-vn",
    "-c:a", "aac",
    "-b:a", "192k",
    outPath,
  ]);
}
