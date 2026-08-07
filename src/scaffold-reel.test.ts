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

  it("scaffolds a from-scratch recipe: no video, staged background image", async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "scaffold-test-"));
    const shot = path.join(tmp, "shot.png");
    await writeFile(shot, "screenshot");

    const projectDir = path.join(tmp, "project");
    await scaffoldReel(
      JSON.stringify({
        output: { durationSeconds: 10 },
        segments: [
          { start: 0, end: 5, caption: "one", backgroundFill: "#0f0c29" },
          { start: 5, end: 10, caption: "two", backgroundImage: shot },
        ],
      }),
      projectDir
    );

    const localized = JSON.parse(
      await readFile(path.join(projectDir, "recipe.json"), "utf8")
    );
    expect(localized.background.video).toBeUndefined();
    expect(localized.segments[0].backgroundFill).toBe("#0f0c29");
    expect(localized.segments[1].backgroundImage).toBe("shot.png");
    expect(
      await readFile(path.join(projectDir, "public", "shot.png"), "utf8")
    ).toBe("screenshot");
  });

  it("refuses a non-empty target that isn't a reel project, allows re-scaffolding one", async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "scaffold-test-"));
    const video = path.join(tmp, "clip.mp4");
    await writeFile(video, "footage");
    const recipeJson = JSON.stringify({
      output: { durationSeconds: 10 },
      background: { video },
      segments: [{ start: 0, end: 5, caption: "hi" }],
    });

    const occupied = path.join(tmp, "occupied");
    await mkdir(occupied);
    await writeFile(path.join(occupied, "notes.txt"), "not a reel project");
    await expect(scaffoldReel(recipeJson, occupied)).rejects.toThrow("isn't empty");

    const projectDir = path.join(tmp, "project");
    await scaffoldReel(recipeJson, projectDir);
    await expect(scaffoldReel(recipeJson, projectDir)).resolves.toBeTruthy();
  });
});
