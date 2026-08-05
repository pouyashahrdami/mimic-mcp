import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  accumulateMotion,
  estimateBpm,
  fingerprintTransition,
  planFilmstrip,
  planShotFrames,
  shotsFromCuts,
  summarizeShotMotion,
  type FramePosition,
  type SceneCut,
  type ShotMotion,
} from "../analysis.js";
import { tryAubioBeats } from "../aubio.js";
import { buildCaptionTrack, type CaptionEvent } from "../captions.js";
import {
  decodeShotForMotion,
  detectBeats,
  detectSceneCuts,
  extractCrop,
  extractFilmstrip,
  extractFrame,
  extractFramesForOcr,
  probe,
} from "../ffmpeg.js";
import { tryOcrFrames } from "../ocr.js";
import { mapLimit } from "../parallel.js";
import type { MeasuredTransition, StyleSpec } from "../style-spec.js";

// More shots than this stops being "study the style" and starts being noise.
const MAX_SAMPLED_SHOTS = 8;

// ffmpeg invocations per extraction batch — each is a short seek+decode, so a
// handful in flight saturates the disk without swamping the machine.
const FFMPEG_CONCURRENCY = 4;

export interface ShotFrame {
  position: FramePosition;
  atSeconds: number;
  file: string;
}

export interface Filmstrip {
  file: string;
  /** Timestamp of each tile, reading left-to-right, top-to-bottom. */
  frameTimes: number[];
  cols: number;
  rows: number;
}

export interface ShotAnalysis {
  start: number;
  end: number;
  seconds: number;
  frames: ShotFrame[];
  /**
   * Contact sheet of the whole shot: evenly spaced tiles in one image, so
   * the motion arc (zoom, pan, gesture) reads at a glance instead of being
   * inferred from three separated stills.
   */
  filmstrip: Filmstrip | null;
  /**
   * MEASURED in-shot motion (gradient-flow estimation, not eyeballed from
   * frames): zoom/pan magnitude with fitted easing. Null for unsampled or
   * too-short shots.
   */
  motion: ShotMotion | null;
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
   * Each shot-to-shot transition fingerprinted from the full-fps frames
   * around it: hard cut, dissolve, dip-to-black/white, or directional wipe —
   * with its measured on-screen duration.
   */
  transitions: (MeasuredTransition & {
    /** Native-fps burst strip across the transition — every frame visible. */
    filmstrip?: Filmstrip;
  })[];
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
  /**
   * OCR'd caption track (macOS Vision): every on-screen text with measured
   * timing, position, size and case. Null when OCR isn't available.
   */
  captions: CaptionEvent[] | null;
  /** Close-up crop of the biggest caption, for matching the font visually. */
  captionSample?: string;
  /** The measured style spec, also written to style-spec.json in the work dir. */
  styleSpec: StyleSpec;
  styleSpecFile: string;
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
    filmstrip: null,
    motion: null,
  }));

  // Measure in-shot motion (punch-ins, pans, easing) on the sampled shots.
  // Only shots long enough for the integration to rise above jitter; the
  // decode window is capped so one very long take doesn't dominate runtime.
  const MIN_MOTION_SHOT_SECONDS = 0.4;
  const MAX_MOTION_SECONDS = 20;
  const sampledIndices = [...new Set(plannedFrames.map((f) => f.shotIndex))];
  await mapLimit(sampledIndices, FFMPEG_CONCURRENCY, async (shotIndex) => {
    const shot = shotRanges[shotIndex];
    const length = shot.end - shot.start;
    if (length < MIN_MOTION_SHOT_SECONDS) return;
    // Inset past the boundary frames, which are often mid-transition.
    const start = shot.start + Math.min(0.1, length / 10);
    const end = Math.min(shot.end - Math.min(0.1, length / 10), start + MAX_MOTION_SECONDS);
    const { frames, width, height, fps } = await decodeShotForMotion(
      videoPath,
      start,
      end,
      info.fps
    );
    const samples = accumulateMotion(frames, width, height, fps, start);
    shots[shotIndex].motion = summarizeShotMotion(samples, width, height);
  });

  // Fingerprint every shot-to-shot transition from the frames around it, and
  // pair it with a native-fps burst strip so even a 3-frame flash is visible.
  const TRANSITION_WINDOW = 0.5;
  const BURST_WINDOW = 0.25;
  const transitions = (
    await mapLimit(cuts, FFMPEG_CONCURRENCY, async (t) => {
      const start = Math.max(0, t - TRANSITION_WINDOW);
      const end = Math.min(info.videoSeconds, t + TRANSITION_WINDOW);
      const { frames, width, height, fps } = await decodeShotForMotion(
        videoPath,
        start,
        end,
        info.fps
      );
      const fp = fingerprintTransition(frames, width, height, fps);
      if (!fp) return null;

      const burstStart = Math.max(0, t - BURST_WINDOW);
      const burstEnd = Math.min(info.videoSeconds, t + BURST_WINDOW);
      const plan = planFilmstrip(burstStart, burstEnd, info.fps);
      let filmstrip: Filmstrip | undefined;
      if (plan) {
        const file = path.join(outDir, `transition-${t.toFixed(2)}s-strip.jpg`);
        await extractFilmstrip(videoPath, burstStart, file, plan);
        filmstrip = {
          file,
          frameTimes: plan.frameTimes,
          cols: plan.cols,
          rows: plan.rows,
        };
      }

      return {
        time: Math.round(t * 100) / 100,
        kind: fp.kind,
        durationSeconds: fp.durationSeconds,
        ...(fp.direction ? { direction: fp.direction } : {}),
        ...(filmstrip ? { filmstrip } : {}),
      };
    })
  ).filter((t): t is NonNullable<typeof t> => t !== null);
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
  const overlayChanges = await mapLimit(
    sampledOverlayTimes,
    FFMPEG_CONCURRENCY,
    async (t) => {
      const at = Math.min(t + 0.1, info.videoSeconds - 1 / info.fps);
      const file = path.join(outDir, `overlay-${t.toFixed(2)}s.jpg`);
      await extractFrame(videoPath, at, file);
      return { atSeconds: Math.round(t * 100) / 100, file };
    }
  );

  // One contact sheet per sampled shot: the whole motion arc in one image.
  await mapLimit(sampledIndices, FFMPEG_CONCURRENCY, async (shotIndex) => {
    const shot = shotRanges[shotIndex];
    const plan = planFilmstrip(shot.start, shot.end, info.fps);
    if (!plan) return;
    const file = path.join(
      outDir,
      `shot-${String(shotIndex + 1).padStart(2, "0")}-strip.jpg`
    );
    await extractFilmstrip(videoPath, shot.start, file, plan);
    shots[shotIndex].filmstrip = {
      file,
      frameTimes: plan.frameTimes,
      cols: plan.cols,
      rows: plan.rows,
    };
  });

  const keyframes: { atSeconds: number; file: string }[] = [];
  const extractedFrames = await mapLimit(
    plannedFrames,
    FFMPEG_CONCURRENCY,
    async (f) => {
      const file = path.join(
        outDir,
        `shot-${String(f.shotIndex + 1).padStart(2, "0")}-${f.position}-${f.atSeconds.toFixed(2)}s.jpg`
      );
      await extractFrame(videoPath, f.atSeconds, file);
      return { f, file };
    }
  );
  for (const { f, file } of extractedFrames) {
    const atSeconds = Math.round(f.atSeconds * 100) / 100;
    shots[f.shotIndex].frames.push({ position: f.position, atSeconds, file });
    keyframes.push({ atSeconds, file });
  }

  // OCR pass: sample frames a few times a second, read every on-screen text
  // with Vision, and fold the sightings into a measured caption track.
  const OCR_FPS = 2.5;
  const MAX_OCR_FRAMES = 80;
  const ocrDir = path.join(outDir, "ocr-frames");
  await mkdir(ocrDir, { recursive: true });
  const ocrFrames = await extractFramesForOcr(videoPath, ocrDir, OCR_FPS, MAX_OCR_FRAMES);
  const ocrResults = await tryOcrFrames(ocrFrames);
  const captions = ocrResults ? buildCaptionTrack(ocrResults) : null;

  // Crop the biggest caption out of the video at full quality so the agent
  // can match the font against a specimen instead of guessing from thumbnails.
  let captionSample: string | undefined;
  if (captions && captions.length > 0) {
    const biggest = captions.reduce((a, b) => (b.lineHeight > a.lineHeight ? b : a));
    const pad = biggest.h * 0.6;
    captionSample = path.join(outDir, "caption-sample.jpg");
    await extractCrop(
      videoPath,
      (biggest.start + biggest.end) / 2,
      {
        x: Math.max(0, biggest.x - pad),
        y: Math.max(0, biggest.y - pad),
        w: Math.min(1 - Math.max(0, biggest.x - pad), biggest.w + pad * 2),
        h: Math.min(1 - Math.max(0, biggest.y - pad), biggest.h + pad * 2),
      },
      captionSample
    );
  }

  const shotCount = cuts.length + 1;
  const averageShotSeconds =
    Math.round((info.videoSeconds / shotCount) * 100) / 100;

  const notes: string[] = [];
  const sampledShots = shots.filter((s) => s.frames.length > 0).length;
  if (sampledShots > 0) {
    notes.push(
      "Each sampled shot has a `filmstrip` contact sheet (tiles read left-to-right, top-to-" +
        "bottom; `frameTimes` gives each tile's timestamp) — open it to see the shot's whole " +
        "arc in one image. The start/mid/end stills are full-resolution for detail checks. " +
        "Each transition has a native-fps burst strip, so even 2-3 frame flashes are visible."
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
      `${overlayTimes.length} localized change(s) detected on a held shot ` +
        "(see `overlayChanges` — a frame was extracted after each one). Open those frames: " +
        "an on-screen graphic swapping (the \"stats card cycling on every beat\" pattern — " +
        "recreate with one segment per swap, each with its own `image`, snapped to `beats`) " +
        "looks different from the subject jumping between poses (a timelapse — recreate " +
        "with segment cuts or speed ramps at those times)."
    );
  }
  const softTransitions = transitions.filter((t) => t.kind !== "cut");
  if (softTransitions.length > 0) {
    const described = softTransitions
      .map(
        (t) =>
          `${t.time}s: ${t.kind}${t.direction ? ` ${t.direction}` : ""} over ${t.durationSeconds}s`
      )
      .join("; ");
    notes.push(
      `MEASURED transitions (fingerprinted from the frames, not guessed): ${described}. ` +
        "Everything not listed is a hard cut. Match each in the recipe."
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

  const movingShots = shots.filter((s) => s.motion && s.motion.type !== "static");
  if (movingShots.length > 0) {
    const described = movingShots
      .map((s) => {
        const m = s.motion!;
        const parts: string[] = [];
        if (m.type.includes("zoom")) {
          parts.push(`${m.scaleTo > 1 ? "punch-in to" : "pull-out to"} ${Math.round(m.scaleTo * 100)}%`);
        }
        if (m.type.includes("pan")) {
          parts.push(`pan ${Math.round(m.panX * 100)}%x/${Math.round(m.panY * 100)}%y`);
        }
        return `${s.start}-${s.end}s: ${parts.join(" + ")}${m.easing ? ` (${m.easing})` : ""}`;
      })
      .join("; ");
    notes.push(
      `MEASURED in-shot motion (no need to eyeball the frames for this): ${described}. ` +
        "Copy these into the matching segments' `zoom` (from/to = 1/scaleTo) — the numbers " +
        "are measured from the reference, not guessed."
    );
  }

  if (captions === null) {
    notes.push(
      "Caption OCR unavailable (needs macOS with the Swift toolchain — `xcode-select --install`). " +
        "Read caption text, timing and position from the filmstrips instead."
    );
  } else if (captions.length > 0) {
    const described = captions
      .slice(0, 12)
      .map(
        (c) =>
          `"${c.text}" ${c.start}-${c.end}s (${c.band}, ~${Math.round(c.lineHeight * info.height)}px` +
          `${c.uppercase ? ", UPPERCASE" : ""})`
      )
      .join("; ");
    notes.push(
      `MEASURED captions (OCR, not guessed): ${described}${captions.length > 12 ? "; …" : ""}. ` +
        "Use these exact timings/positions/sizes for the recipe's segments. " +
        (captionSample
          ? "Open `captionSample` (a full-quality crop) to identify the font: check weight, " +
            "serif vs sans, rounded vs sharp terminals, and set captionFont to the closest match."
          : "")
    );
  } else {
    notes.push("OCR found no on-screen text — the reference carries no burned-in captions.");
  }

  const styleSpec: StyleSpec = {
    source: videoPath,
    durationSeconds: info.durationSeconds,
    width: info.width,
    height: info.height,
    fps: info.fps,
    shots: shots.map((s) => ({ start: s.start, end: s.end, motion: s.motion })),
    transitions: transitions.map(({ filmstrip: _strip, ...t }) => t),
    overlayChanges: overlayTimes.map((t) => Math.round(t * 100) / 100),
    captions,
    beats,
    bpm,
  };
  const styleSpecFile = path.join(outDir, "style-spec.json");
  await writeFile(styleSpecFile, JSON.stringify(styleSpec, null, 2));

  return {
    video: videoPath,
    durationSeconds: info.durationSeconds,
    width: info.width,
    height: info.height,
    fps: info.fps,
    hasAudio: info.hasAudio,
    sceneCuts: cuts.map((c) => Math.round(c * 100) / 100),
    cuts: detectedCuts,
    transitions,
    overlayChanges,
    averageShotSeconds,
    beats,
    bpm,
    beatMethod,
    shots,
    keyframes,
    captions,
    ...(captionSample ? { captionSample } : {}),
    styleSpec,
    styleSpecFile,
    notes,
  };
}
