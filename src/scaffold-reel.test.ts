import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scaffoldReel } from "./tools/scaffold-reel.js";

let tmp: string;

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("scaffoldReel", () => {
  it("keeps distinct same-named sources apart and copies a reused source once", async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "scaffold-test-"));
    const dirA = path.join(tmp, "shoot-a");
    const dirB = path.join(tmp, "shoot-b");
    await mkdir(dirA);
    await mkdir(dirB);
    const mainVideo = path.join(dirA, "clip.mp4");
    const otherVideo = path.join(dirB, "clip.mp4");
    await writeFile(mainVideo, "footage A");
    await writeFile(otherVideo, "footage B");

    const projectDir = path.join(tmp, "project");
    await scaffoldReel(
      JSON.stringify({
        output: { durationSeconds: 10 },
        background: { video: mainVideo },
        segments: [
          { start: 0, end: 5, caption: "one", backgroundVideo: otherVideo },
          { start: 5, end: 10, caption: "two", backgroundVideo: otherVideo },
        ],
      }),
      projectDir
    );

    const localized = JSON.parse(
      await readFile(path.join(projectDir, "recipe.json"), "utf8")
    );
    expect(localized.background.video).toBe("clip.mp4");
    expect(localized.segments[0].backgroundVideo).toBe("clip-2.mp4");
    // The reused source resolves to the same staged copy, not a third file.
    expect(localized.segments[1].backgroundVideo).toBe("clip-2.mp4");

    const publicDir = path.join(projectDir, "public");
    expect(await readFile(path.join(publicDir, "clip.mp4"), "utf8")).toBe("footage A");
    expect(await readFile(path.join(publicDir, "clip-2.mp4"), "utf8")).toBe("footage B");
  });
});
