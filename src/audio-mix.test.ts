import { describe, expect, it } from "vitest";
import { duckWindow, musicGain } from "../templates/remotion/src/audio.js";

const base = {
  fps: 30,
  durationInFrames: 300, // 10s
  volume: 0.8,
  fadeInSeconds: 0,
  fadeOutSeconds: 0,
};

describe("musicGain", () => {
  it("holds the base volume with no fades or ducking", () => {
    expect(musicGain({ ...base, frame: 150 })).toBeCloseTo(0.8);
  });

  it("ramps up over the fade-in and is untouched after it", () => {
    const p = { ...base, fadeInSeconds: 2 };
    expect(musicGain({ ...p, frame: 0 })).toBe(0);
    expect(musicGain({ ...p, frame: 30 })).toBeCloseTo(0.4);
    expect(musicGain({ ...p, frame: 60 })).toBeCloseTo(0.8);
    expect(musicGain({ ...p, frame: 200 })).toBeCloseTo(0.8);
  });

  it("ramps down into the final frames instead of cutting off", () => {
    const p = { ...base, fadeOutSeconds: 2 };
    expect(musicGain({ ...p, frame: 100 })).toBeCloseTo(0.8);
    expect(musicGain({ ...p, frame: 240 })).toBeCloseTo(0.8); // fade starts here
    expect(musicGain({ ...p, frame: 270 })).toBeCloseTo(0.4);
    expect(musicGain({ ...p, frame: 300 })).toBe(0);
  });

  it("ducks under narration and recovers after it", () => {
    const duck = { startFrame: 90, endFrame: 210, to: 0.25 };
    const p = { ...base, duck };
    expect(musicGain({ ...p, frame: 0 })).toBeCloseTo(0.8);
    expect(musicGain({ ...p, frame: 150 })).toBeCloseTo(0.2); // 0.8 * 0.25
    expect(musicGain({ ...p, frame: 299 })).toBeCloseTo(0.8);
  });

  it("starts ducking before the first syllable and releases after the last", () => {
    const duck = { startFrame: 90, endFrame: 210, to: 0.25 };
    const p = { ...base, duck };
    // 0.4s ramp at 30fps = 12 frames.
    expect(musicGain({ ...p, frame: 84 })).toBeLessThan(0.8);
    expect(musicGain({ ...p, frame: 84 })).toBeGreaterThan(0.2);
    expect(musicGain({ ...p, frame: 216 })).toBeLessThan(0.8);
    expect(musicGain({ ...p, frame: 216 })).toBeGreaterThan(0.2);
    // Fully out of the ramp on both sides.
    expect(musicGain({ ...p, frame: 70 })).toBeCloseTo(0.8);
    expect(musicGain({ ...p, frame: 230 })).toBeCloseTo(0.8);
  });

  it("never leaves 0..1 even when fades and ducking stack", () => {
    const p = { ...base, volume: 1, fadeInSeconds: 2, fadeOutSeconds: 2 };
    const duck = { startFrame: 0, endFrame: 300, to: 0.25 };
    for (let frame = 0; frame <= 300; frame += 5) {
      const gain = musicGain({ ...p, frame, duck });
      expect(gain).toBeGreaterThanOrEqual(0);
      expect(gain).toBeLessThanOrEqual(1);
    }
  });
});

describe("duckWindow", () => {
  const music = { duckUnderVoiceover: true, duckTo: 0.25 };

  it("spans the narration when its duration is known", () => {
    expect(duckWindow({ startSeconds: 1, durationSeconds: 4 }, music, 30, 300)).toEqual({
      startFrame: 30,
      endFrame: 150,
      to: 0.25,
    });
  });

  it("runs to the end of the reel when the narration length is unknown", () => {
    expect(duckWindow({ startSeconds: 1 }, music, 30, 300)?.endFrame).toBe(300);
  });

  it("is off with no voiceover, no music, or ducking disabled", () => {
    expect(duckWindow(undefined, music, 30, 300)).toBeUndefined();
    expect(duckWindow({ startSeconds: 0 }, undefined, 30, 300)).toBeUndefined();
    expect(
      duckWindow({ startSeconds: 0 }, { duckUnderVoiceover: false, duckTo: 0.25 }, 30, 300)
    ).toBeUndefined();
  });
});
