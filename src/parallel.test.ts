import { describe, expect, it } from "vitest";
import { mapLimit } from "./parallel.js";

describe("mapLimit", () => {
  it("preserves input order regardless of completion order", async () => {
    const delays = [30, 5, 20, 1];
    const results = await mapLimit(delays, 2, async (d, i) => {
      await new Promise((r) => setTimeout(r, d));
      return i;
    });
    expect(results).toEqual([0, 1, 2, 3]);
  });

  it("never runs more than `limit` tasks at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("handles an empty input", async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});
