import type { CaptionEvent } from "./captions.js";

/**
 * Where each platform's own UI sits on top of a vertical video.
 *
 * A reel can match its reference perfectly and still ship broken, because the
 * app draws its caption bar, action rail and handle over the bottom and right
 * of the frame. Nothing else in the pipeline knows those regions exist — the
 * fidelity score is measured against the reference, which had the same problem
 * or solved it off-camera.
 *
 * The rectangles are deliberately conservative approximations: the chrome moves
 * between app versions and locales, so treat a hit as "check this", not as a
 * pixel-exact verdict.
 */

/** Normalized rectangle, top-left origin, 0..1 of the frame. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface UnsafeRegion {
  name: string;
  rect: Rect;
}

export interface Platform {
  label: string;
  regions: UnsafeRegion[];
}

export const PLATFORMS: Record<string, Platform> = {
  tiktok: {
    label: "TikTok",
    regions: [
      { name: "top tab bar (Following / For You)", rect: { x: 0, y: 0, w: 1, h: 0.08 } },
      { name: "right action rail (like/comment/share)", rect: { x: 0.82, y: 0.42, w: 0.18, h: 0.44 } },
      { name: "bottom caption + handle", rect: { x: 0, y: 0.82, w: 0.88, h: 0.18 } },
    ],
  },
  instagram: {
    label: "Instagram Reels",
    regions: [
      { name: "right action rail", rect: { x: 0.84, y: 0.46, w: 0.16, h: 0.4 } },
      { name: "bottom caption + audio strip", rect: { x: 0, y: 0.8, w: 0.86, h: 0.2 } },
    ],
  },
  "youtube-shorts": {
    label: "YouTube Shorts",
    regions: [
      { name: "right action rail", rect: { x: 0.85, y: 0.4, w: 0.15, h: 0.45 } },
      { name: "bottom title + channel row", rect: { x: 0, y: 0.84, w: 0.85, h: 0.16 } },
    ],
  },
};

export const PLATFORM_NAMES = Object.keys(PLATFORMS);

/** Fraction of a caption that must be covered before it's worth reporting. */
const REPORT_THRESHOLD = 0.12;

export interface SafeAreaIssue {
  text: string;
  start: number;
  end: number;
  region: string;
  /** How much of the caption's box the UI covers, 0..1. */
  covered: number;
  fix: string;
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Report captions the platform's chrome would sit on top of, worst first. Each
 * issue names the recipe field to change, matching how the fidelity report
 * reads — an issue you can't act on is just noise.
 */
export function checkSafeArea(
  captions: CaptionEvent[],
  platform: Platform
): SafeAreaIssue[] {
  const issues: SafeAreaIssue[] = [];

  for (const caption of captions) {
    const box: Rect = { x: caption.x, y: caption.y, w: caption.w, h: caption.h };
    const area = box.w * box.h;
    if (area <= 0) continue;

    for (const region of platform.regions) {
      const covered = overlapArea(box, region.rect) / area;
      if (covered < REPORT_THRESHOLD) continue;
      issues.push({
        text: caption.text,
        start: caption.start,
        end: caption.end,
        region: region.name,
        covered: Math.round(covered * 100) / 100,
        fix: fixFor(region.rect),
      });
    }
  }

  return issues.sort((a, b) => b.covered - a.covered);
}

/** The recipe change that moves a caption out of a given region. */
function fixFor(region: Rect): string {
  if (region.y >= 0.6) {
    return 'move it up — captionPosition "center", or raise it off the bottom band';
  }
  if (region.y + region.h <= 0.2) {
    return 'move it down — captionPosition "center" instead of "top"';
  }
  return "narrow or re-position the caption so it clears the right-hand action rail";
}
