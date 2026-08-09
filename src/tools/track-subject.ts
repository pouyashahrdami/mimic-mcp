import { decodeGrayFrames, probe } from "../ffmpeg.js";
import { suggestFraming } from "../framing.js";
import { mapLimit } from "../parallel.js";
import {
  buildTrack,
  toPositionString,
  type Keyframe,
  type TrackPoint,
} from "../subject-track.js";

const ANALYSIS_WIDTH = 64;
const ANALYSIS_HEIGHT = 64;
const ANALYSIS_FPS = 6;

const FFMPEG_CONCURRENCY = 4;

/**
 * How long each measurement window is. Short enough to catch someone walking,
 * long enough that a window still holds enough frames for motion to register.
 */
const DEFAULT_WINDOW_SECONDS = 0.5;

/** Windows below this can't be measured; above it the track stops being a track. */
const MIN_WINDOW_SECONDS = 0.2;
const MAX_WINDOWS = 120;

export interface SubjectTrack {
  start: number;
  end: number;
  /** Keyframes for the segment's `backgroundTrack`, or null when it's static. */
  backgroundTrack: Keyframe[] | null;
  /** Use this as `backgroundPosition` instead when there's no track. */
  backgroundPosition: string | null;
  travelX: number;
  travelY: number;
  reason: string;
}

export interface TrackSubjectResult {
  spans: SubjectTrack[];
  instructions: string;
}

/**
 * Follow the subject across each span, so a cover-crop keeps someone who moves.
 *
 * `suggest_framing` measures one position per span, which loses anyone who
 * walks; this measures per window and returns keyframes — or says plainly that
 * the subject held still and one position is the better answer.
 */
export async function trackSubject(
  video: string,
  spans: { start: number; end: number }[] | undefined,
  { windowSeconds = DEFAULT_WINDOW_SECONDS }: { windowSeconds?: number } = {}
): Promise<TrackSubjectResult> {
  if (windowSeconds < MIN_WINDOW_SECONDS) {
    throw new Error(
      `windowSeconds must be at least ${MIN_WINDOW_SECONDS} — a shorter window holds too few ` +
        "frames to locate a subject in."
    );
  }

  const info = await probe(video);
  const ranges = spans && spans.length > 0 ? spans : [{ start: 0, end: info.videoSeconds }];

  for (const [i, span] of ranges.entries()) {
    if (span.end <= span.start) {
      throw new Error(`span ${i}: end (${span.end}) must be after start (${span.start})`);
    }
    if (span.start < 0 || span.end > info.videoSeconds + 0.5) {
      throw new Error(
        `span ${i}: ${span.start}..${span.end}s is outside the footage, which runs ` +
          `0..${Math.round(info.videoSeconds * 100) / 100}s`
      );
    }
  }

  const results: SubjectTrack[] = [];

  for (const span of ranges) {
    const seconds = span.end - span.start;
    const windowCount = Math.min(MAX_WINDOWS, Math.max(1, Math.floor(seconds / windowSeconds)));
    const step = seconds / windowCount;

    const windows = Array.from({ length: windowCount }, (_, i) => ({
      offset: i * step,
      start: span.start + i * step,
    }));

    const points = await mapLimit(windows, FFMPEG_CONCURRENCY, async (w): Promise<TrackPoint> => {
      const { frames } = await decodeGrayFrames(video, {
        width: ANALYSIS_WIDTH,
        height: ANALYSIS_HEIGHT,
        fps: ANALYSIS_FPS,
        start: w.start,
        duration: step,
      });
      // A window at the very end can decode empty; treat it as unmeasured
      // rather than failing the whole span.
      if (frames.length === 0) {
        return { atSeconds: w.offset, x: 0.5, y: 0.5, confidence: 0 };
      }
      const framing = suggestFraming(frames, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      return {
        atSeconds: Math.round(w.offset * 100) / 100,
        x: framing.focusX,
        y: framing.focusY,
        confidence: framing.confidence,
      };
    });

    const built = buildTrack(points);
    results.push({
      start: span.start,
      end: span.end,
      backgroundTrack: built.track,
      backgroundPosition: built.staticPosition ? toPositionString(built.staticPosition) : null,
      travelX: built.travelX,
      travelY: built.travelY,
      reason: built.reason,
    });
  }

  const tracked = results.filter((r) => r.backgroundTrack !== null).length;

  return {
    spans: results,
    instructions:
      `${tracked} of ${results.length} span(s) had a subject worth following. Where ` +
      "`backgroundTrack` is set, paste it into that segment — its keyframe times are relative " +
      "to the SEGMENT's start, and it overrides `backgroundPosition`. Where it is null the " +
      "subject held still and `backgroundPosition` is the better answer, because a crop that " +
      "chases a still subject only jitters. Both are null when no window found a subject at " +
      "all — leave that segment centred rather than aiming it at a guess.",
  };
}
