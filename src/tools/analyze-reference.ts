import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  estimateBpm,
  planShotFrames,
  shotsFromCuts,
  type FramePosition,
  type SceneCut,
} from "../analysis.js";
import { tryAubioBeats } from "../aubio.js";
import { detectBeats, detectSceneCuts, extractFrame, probe } from "../ffmpeg.js";

// More shots than this stops being "study the style" and starts being noise.
const MAX_SAMPLED_SHOTS = 8;

export interface ShotFrame {
  position: FramePosition;
  atSeconds: number;
  file: string;
}

export interface ShotAnalysis {
  start: number;
  end: number;
  seconds: number;
  frames: ShotFrame[];
}

export interface ReferenceAnalysis {
  video: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  sceneCuts: number[];
  /** Every detection with its score and measured type (cut, fade, overlay). */
  cuts: SceneCut[];
  /**
   * On-screen graphic swaps on a held shot (stats cards, screenshots): when
   * they happened, with a frame extracted just after each swap so you can see
   * every state of the graphic.
   */
  overlayChanges: { atSeconds: number; file: string }[];
  averageShotSeconds: number;
  beats: number[];
  bpm: number | null;
  /** "aubio" = real beat tracking; "rms-onset" = ffmpeg energy-rise fallback. */
  beatMethod: "aubio" | "rms-onset" | null;
  shots: ShotAnalysis[];
  keyframes: { atSeconds: number; file: string }[];
  notes: string[];
}

/**
 * Probe the reference reel, find its cuts, and dump keyframes so the calling
 * agent can look at what each shot actually contains. Output lands in
 * `.mimic-mcp/<video-name>/` next to the cwd.
 */
export async function analyzeReference(
  videoPath: string,
  workDir: string
): Promise<ReferenceAnalysis> {
  const info = await probe(videoPath);
  const detectedCuts = await detectSceneCuts(videoPath);
  // Overlay changes are graphics swapping on a held shot — they subdivide the
  // content, not the camera work, so shots and pacing stats ignore them.
  const cuts = detectedCuts.filter((c) => c.type !== "overlay").map((c) => c.time);
  const overlayTimes = detectedCuts.filter((c) => c.type === "overlay").map((c) => c.time);
  let beats: number[] = [];
  let bpm: number | null = null;
  let beatMethod: ReferenceAnalysis["beatMethod"] = null;
  if (info.hasAudio) {
    const aubioBeats = await tryAubioBeats(videoPath);
    if (aubioBeats && aubioBeats.length > 0) {
      beats = aubioBeats;
      bpm = estimateBpm(aubioBeats);
      beatMethod = "aubio";
    } else {
      ({ beats, bpm } = await detectBeats(videoPath));
      beatMethod = "rms-onset";
    }
  }

  const outDir = path.join(
    workDir,
    ".mimic-mcp",
    path.basename(videoPath, path.extname(videoPath))
  );
  await mkdir(outDir, { recursive: true });

  // Start/mid/end frames per shot: motion inside a shot (the classic slow
  // punch-in zoom, pans) is invisible in a single mid frame but obvious when
  // the shot's frames are compared. Shots span the VIDEO stream, not the
  // container — audio often runs longer and there are no frames out there.
  const shotRanges = shotsFromCuts(cuts, info.videoSeconds);
  const plannedFrames = planShotFrames(shotRanges, MAX_SAMPLED_SHOTS);

  const shots: ShotAnalysis[] = shotRanges.map((s) => ({
    start: Math.round(s.start * 100) / 100,
    end: Math.round(s.end * 100) / 100,
    seconds: Math.round((s.end - s.start) * 100) / 100,
    frames: [],
  }));
  // One frame just after each overlay swap, so every state of an on-screen
  // graphic is visible — a single mid-shot frame only ever catches one.
  const MAX_OVERLAY_FRAMES = 12;
  let sampledOverlayTimes = overlayTimes;
  if (sampledOverlayTimes.length > MAX_OVERLAY_FRAMES) {
    const step = sampledOverlayTimes.length / MAX_OVERLAY_FRAMES;
    sampledOverlayTimes = Array.from(
      { length: MAX_OVERLAY_FRAMES },
      (_, i) => sampledOverlayTimes[Math.floor(i * step)]
    );
  }
  const overlayChanges: { atSeconds: number; file: string }[] = [];
  for (const t of sampledOverlayTimes) {
    const at = Math.min(t + 0.1, info.videoSeconds - 1 / info.fps);
    const file = path.join(outDir, `overlay-${t.toFixed(2)}s.jpg`);
    await extractFrame(videoPath, at, file);
    overlayChanges.push({ atSeconds: Math.round(t * 100) / 100, file });
  }

  const keyframes: { atSeconds: number; file: string }[] = [];
  for (const f of plannedFrames) {
    const file = path.join(
      outDir,
      `shot-${String(f.shotIndex + 1).padStart(2, "0")}-${f.position}-${f.atSeconds.toFixed(2)}s.jpg`
    );
    await extractFrame(videoPath, f.atSeconds, file);
    const atSeconds = Math.round(f.atSeconds * 100) / 100;
    shots[f.shotIndex].frames.push({ position: f.position, atSeconds, file });
    keyframes.push({ atSeconds, file });
  }

  const shotCount = cuts.length + 1;
  const averageShotSeconds =
    Math.round((info.videoSeconds / shotCount) * 100) / 100;

  const notes: string[] = [];
  const sampledShots = shots.filter((s) => s.frames.length > 0).length;
  if (sampledShots > 0) {
    notes.push(
      "Each sampled shot has start/mid/end frames. Compare them per shot: the subject growing " +
        "from start to end = punch-in zoom (set that segment's `zoom`), the framing sliding " +
        "sideways = a pan. Identical frames = a static shot."
    );
  }
  if (sampledShots < shots.length) {
    notes.push(
      `${shots.length} shots detected but only ${sampledShots} were sampled for frames ` +
        "(evenly spread) to keep the image count reviewable."
    );
  }
  if (averageShotSeconds < 0.4 && cuts.length > 6) {
    notes.push(
      "Extremely rapid cuts detected. This is either camera motion fooling the detector " +
        "OR a genuine beat-synced flash montage (common in motivational reels). " +
        "Check the keyframes: if they show clearly different scenes, it's a real montage — " +
        "recreate it with short segments using different backgroundStart offsets."
    );
  }
  if (cuts.length === 0) {
    notes.push(
      "No hard cuts detected — the reference is likely a single continuous shot, or uses only soft transitions."
    );
  }
  if (overlayTimes.length > 0) {
    notes.push(
      `${overlayTimes.length} on-screen graphic change(s) detected on a held shot ` +
        "(see `overlayChanges` — a frame was extracted after each swap). This is the " +
        "\"stats card cycling on every beat\" pattern: recreate it with one segment per " +
        "swap, each with its own `image`, boundaries snapped to the `beats` timestamps."
    );
  }
  const fadeCount = detectedCuts.filter((c) => c.type === "fade").length;
  if (fadeCount > 0) {
    notes.push(
      `${fadeCount} of the ${detectedCuts.length} transitions measured as fades/dissolves ` +
        "(see `cuts[].type`) — use transitionIn \"fade\" for the segments starting there, " +
        "and \"cut\" for the rest."
    );
  }
  if (!info.hasAudio) {
    notes.push("Reference has no audio track, so extract_music will fail on it.");
  }
  if (beats.length >= 4) {
    const source =
      beatMethod === "aubio" ? "beats (aubio beat tracker)" : "musical onsets";
    notes.push(
      `Detected ${beats.length} ${source}${bpm ? ` (~${bpm} BPM)` : ""}. ` +
        "For a beat-synced feel, align your segment start/end times to the `beats` timestamps " +
        "rather than spacing cuts evenly."
    );
  }
  if (beatMethod === "rms-onset") {
    notes.push(
      "Beats came from the RMS energy-rise fallback, which fires on speech plosives and misses " +
        "quiet beats. Installing aubio (`brew install aubio`) upgrades this to real beat tracking."
    );
  }

  return {
    video: videoPath,
    durationSeconds: info.durationSeconds,
    width: info.width,
    height: info.height,
    fps: info.fps,
    hasAudio: info.hasAudio,
    sceneCuts: cuts.map((c) => Math.round(c * 100) / 100),
    cuts: detectedCuts,
    overlayChanges,
    averageShotSeconds,
    beats,
    bpm,
    beatMethod,
    shots,
    keyframes,
    notes,
  };
}
