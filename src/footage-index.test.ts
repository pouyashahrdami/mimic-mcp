import { describe, expect, it } from "vitest";
import {
  assignShots,
  gradeShot,
  measureShotSignals,
  USABLE_SCORE,
  type IndexedShot,
  type MotionKind,
  type ShotSignals,
} from "./footage-index.js";

const W = 32;
const H = 32;

/** A frame of flat `bg` with a checkerboard patch, so it carries real edges. */
function texturedFrame(bg: number): Uint8Array {
  const frame = new Uint8Array(W * H).fill(bg);
  for (let y = 8; y < 24; y++) {
    for (let x = 8; x < 24; x++) {
      if ((x + y) % 2 === 0) frame[y * W + x] = 255;
    }
  }
  return frame;
}

/**
 * A solid block at `x0` on a mid-gray field. Shifting `x0` translates it
 * rigidly, which is what the flow estimator is built to read — a checkerboard
 * shifted by an odd number of pixels inverts its parity instead of moving.
 */
function frameWithBlockAt(x0: number, bg = 120): Uint8Array {
  const frame = new Uint8Array(W * H).fill(bg);
  for (let y = 11; y < 21; y++) {
    for (let x = x0; x < x0 + 10; x++) {
      if (x >= 0 && x < W) frame[y * W + x] = 255;
    }
  }
  return frame;
}

function flatFrame(value: number): Uint8Array {
  return new Uint8Array(W * H).fill(value);
}

const CLEAN: ShotSignals = {
  brightness: 130,
  contrast: 60,
  detail: 40,
  motion: 0.4,
  jitter: 0,
};

describe("measureShotSignals", () => {
  it("throws rather than guessing when nothing decoded", () => {
    expect(() => measureShotSignals([], W, H)).toThrow(/no frames decoded/);
  });

  it("reads exposure off the middle frame", () => {
    const signals = measureShotSignals([flatFrame(20), flatFrame(20), flatFrame(20)], W, H);
    expect(signals.brightness).toBe(20);
    expect(signals.contrast).toBe(0);
  });

  it("scores a textured frame as carrying more detail than a flat one", () => {
    const textured = measureShotSignals([texturedFrame(40)], W, H);
    const flat = measureShotSignals([flatFrame(40)], W, H);
    expect(textured.detail).toBeGreaterThan(flat.detail);
    expect(flat.detail).toBe(0);
  });

  it("reports no motion for a held frame", () => {
    const held = [texturedFrame(120), texturedFrame(120), texturedFrame(120)];
    const signals = measureShotSignals(held, W, H);
    expect(signals.motion).toBe(0);
    expect(signals.jitter).toBe(0);
  });

  it("calls a steady pan smooth and a reversing shake rough", () => {
    const pan = [6, 8, 10, 12, 14, 16].map((x) => frameWithBlockAt(x));
    // Same distance travelled per frame, opposite directions — the case a
    // magnitude-only measure cannot tell apart from the pan above.
    const shake = [10, 14, 10, 14, 10, 14].map((x) => frameWithBlockAt(x));

    const panned = measureShotSignals(pan, W, H);
    const shaken = measureShotSignals(shake, W, H);

    expect(panned.motion).toBeGreaterThan(0);
    expect(panned.jitter).toBeLessThan(0.2);
    expect(shaken.jitter).toBeGreaterThan(0.6);
  });
});

describe("gradeShot", () => {
  it("gives a clean locked-off shot a perfect score", () => {
    expect(gradeShot(CLEAN)).toEqual({ score: 1, flaws: [], motionKind: "locked" });
  });

  it("flags underexposure and overexposure", () => {
    expect(gradeShot({ ...CLEAN, brightness: 20 }).flaws).toContain("dark");
    expect(gradeShot({ ...CLEAN, brightness: 240 }).flaws).toContain("blown");
  });

  it("flags a fogged shot as flat and a smeared one as soft", () => {
    expect(gradeShot({ ...CLEAN, contrast: 5 }).flaws).toContain("flat");
    expect(gradeShot({ ...CLEAN, detail: 1 }).flaws).toContain("soft");
  });

  it("calls a smooth move moving, not shaky", () => {
    const graded = gradeShot({ ...CLEAN, motion: 8, jitter: 0.1 });
    expect(graded.motionKind).toBe("moving");
    expect(graded.flaws).not.toContain("shaky");
    expect(graded.score).toBe(1);
  });

  it("penalizes shake, but only when something is actually moving", () => {
    expect(gradeShot({ ...CLEAN, motion: 8, jitter: 0.9 }).motionKind).toBe("shaky");
    // High jitter on a still shot is sensor noise, not a shaky camera.
    expect(gradeShot({ ...CLEAN, motion: 0.2, jitter: 0.9 }).motionKind).toBe("locked");
  });

  it("stacks penalties and never goes below zero", () => {
    const wrecked = gradeShot({
      brightness: 10,
      contrast: 2,
      detail: 0.5,
      motion: 9,
      jitter: 0.95,
    });
    expect(wrecked.flaws).toEqual(["dark", "flat", "soft", "shaky"]);
    expect(wrecked.score).toBe(0);
    expect(wrecked.score).toBeLessThan(USABLE_SCORE);
  });
});

function shot(id: string, seconds: number, score: number, motionKind: MotionKind = "locked") {
  return {
    id,
    clip: `/footage/${id}.mp4`,
    start: 0,
    end: seconds,
    seconds,
    signals: CLEAN,
    quality: { score, flaws: [], motionKind },
  } satisfies IndexedShot;
}

describe("assignShots", () => {
  it("returns assignments in the order the needs were given", () => {
    const shots = [shot("a", 5, 0.9), shot("b", 5, 0.8), shot("c", 5, 0.7)];
    const assigned = assignShots(shots, [
      { durationSeconds: 1 },
      { durationSeconds: 4 },
      { durationSeconds: 2 },
    ]);
    expect(assigned.map((a) => a.need)).toEqual([0, 1, 2]);
  });

  it("never uses the same shot twice", () => {
    const shots = [shot("a", 5, 0.9), shot("b", 5, 0.8)];
    const assigned = assignShots(shots, [{ durationSeconds: 2 }, { durationSeconds: 2 }]);
    expect(new Set(assigned.map((a) => a.shotId)).size).toBe(2);
  });

  it("fills the longest need first so a short one can't strand it", () => {
    // Only "long" can cover 8s. Filling the 1s need first would take it if the
    // pick were purely by score.
    const shots = [shot("long", 10, 0.6), shot("short", 2, 0.99)];
    const assigned = assignShots(shots, [{ durationSeconds: 1 }, { durationSeconds: 8 }]);
    expect(assigned[1].shotId).toBe("long");
    expect(assigned[1].shortBySeconds).toBe(0);
    expect(assigned[0].shotId).toBe("short");
  });

  it("prefers the better shot when both cover the need", () => {
    const shots = [shot("good", 5, 0.9), shot("bad", 5, 0.3)];
    const assigned = assignShots(shots, [{ durationSeconds: 3 }]);
    expect(assigned[0].shotId).toBe("good");
  });

  it("breaks a near-tie toward the shot that wastes less footage", () => {
    const shots = [shot("hero", 60, 0.9), shot("snug", 4, 0.88)];
    const assigned = assignShots(shots, [{ durationSeconds: 3 }]);
    expect(assigned[0].shotId).toBe("snug");
  });

  it("honours a motion preference when something qualifies", () => {
    const shots = [shot("still", 5, 0.9), shot("push", 5, 0.85, "moving")];
    const assigned = assignShots(shots, [{ durationSeconds: 3, prefer: "moving" }]);
    expect(assigned[0].shotId).toBe("push");
  });

  it("ignores an unmeetable motion preference rather than returning nothing", () => {
    const shots = [shot("still", 5, 0.9)];
    const assigned = assignShots(shots, [{ durationSeconds: 3, prefer: "moving" }]);
    expect(assigned[0].shotId).toBe("still");
  });

  it("reports the shortfall when nothing is long enough", () => {
    const shots = [shot("a", 3, 0.9), shot("b", 2, 0.9)];
    const assigned = assignShots(shots, [{ durationSeconds: 6 }]);
    expect(assigned[0].shotId).toBe("a");
    expect(assigned[0].shortBySeconds).toBe(3);
    expect(assigned[0].reason).toMatch(/Shorten the segment/);
  });

  it("reports a null shot once the footage runs out", () => {
    const assigned = assignShots([shot("a", 5, 0.9)], [
      { durationSeconds: 2 },
      { durationSeconds: 2 },
    ]);
    const empty = assigned.filter((a) => a.shotId === null);
    expect(empty).toHaveLength(1);
    expect(empty[0].reason).toMatch(/fewer usable shots/);
  });

  it("handles no needs and no shots", () => {
    expect(assignShots([], [])).toEqual([]);
    expect(assignShots([shot("a", 5, 0.9)], [])).toEqual([]);
  });
});
