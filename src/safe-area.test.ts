import { describe, expect, it } from "vitest";
import { checkSafeArea, PLATFORMS, PLATFORM_NAMES } from "./safe-area.js";
import type { CaptionEvent } from "./captions.js";

function caption(over: Partial<CaptionEvent> & { text: string }): CaptionEvent {
  return {
    start: 0,
    end: 2,
    x: 0.1,
    y: 0.45,
    w: 0.8,
    h: 0.08,
    band: "center",
    uppercase: false,
    lineHeight: 0.08,
    ...over,
  };
}

describe("checkSafeArea", () => {
  it("passes a caption sitting in the middle of the frame", () => {
    expect(checkSafeArea([caption({ text: "safe" })], PLATFORMS.tiktok)).toEqual([]);
  });

  it("catches a caption under the bottom caption bar", () => {
    const issues = checkSafeArea(
      [caption({ text: "buried", y: 0.86, h: 0.08 })],
      PLATFORMS.tiktok
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].region).toMatch(/bottom caption/);
    // Not exactly 1: the caption runs past the right edge of the bar's rect.
    expect(issues[0].covered).toBeGreaterThan(0.9);
    expect(issues[0].fix).toMatch(/move it up/);
  });

  it("catches a wide caption running under the right action rail", () => {
    const issues = checkSafeArea(
      [caption({ text: "too wide", x: 0.1, w: 0.88, y: 0.5, h: 0.08 })],
      PLATFORMS.tiktok
    );
    expect(issues.map((i) => i.region)).toContain("right action rail (like/comment/share)");
    expect(issues[0].fix).toMatch(/action rail/);
  });

  it("catches a caption behind the top tab bar", () => {
    const issues = checkSafeArea(
      [caption({ text: "top", y: 0.01, h: 0.05 })],
      PLATFORMS.tiktok
    );
    expect(issues[0].region).toMatch(/top tab bar/);
    expect(issues[0].fix).toMatch(/move it down/);
  });

  it("ignores a caption that only grazes a region", () => {
    // 0.02 of a 0.2-tall caption sits in the bar: 10%, under the threshold.
    const issues = checkSafeArea(
      [caption({ text: "grazing", y: 0.62, h: 0.2 })],
      PLATFORMS.tiktok
    );
    expect(issues).toEqual([]);
  });

  it("reports the worst offender first", () => {
    const issues = checkSafeArea(
      [
        caption({ text: "partly", y: 0.78, h: 0.1 }),
        caption({ text: "fully", y: 0.9, h: 0.08 }),
      ],
      PLATFORMS.tiktok
    );
    expect(issues[0].text).toBe("fully");
    expect(issues[0].covered).toBeGreaterThan(issues[1].covered);
  });

  it("keeps the caption's timing so the frame can be found", () => {
    const issues = checkSafeArea(
      [caption({ text: "buried", y: 0.9, h: 0.06, start: 3.5, end: 5.25 })],
      PLATFORMS.instagram
    );
    expect(issues[0]).toMatchObject({ start: 3.5, end: 5.25 });
  });

  it("defines the same shape for every platform", () => {
    expect(PLATFORM_NAMES.length).toBeGreaterThan(0);
    for (const name of PLATFORM_NAMES) {
      const platform = PLATFORMS[name];
      expect(platform.label).toBeTruthy();
      expect(platform.regions.length).toBeGreaterThan(0);
      for (const { rect } of platform.regions) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(1.0001);
        expect(rect.y + rect.h).toBeLessThanOrEqual(1.0001);
      }
    }
  });
});
