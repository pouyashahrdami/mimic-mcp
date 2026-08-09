import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { recipeSchema } from "../recipe.js";
import { buildCues, toSrt, toVtt } from "../subtitles.js";

export type CaptionFormat = "srt" | "vtt";

/**
 * Write the reel's captions out as subtitle sidecars next to the render, so
 * the text that's burned into the pixels is also machine-readable when the
 * reel is uploaded.
 */
export async function exportCaptions(
  projectDir: string,
  formats: CaptionFormat[] = ["srt"]
): Promise<{ files: string[]; cues: number; nextStep: string }> {
  const projectPath = path.resolve(projectDir);
  const raw = await readFile(path.join(projectPath, "recipe.json"), "utf8").catch(() => {
    throw new Error(
      `${projectDir} doesn't look like a scaffolded reel project (no recipe.json). Run scaffold_reel first.`
    );
  });

  const recipe = recipeSchema.parse(JSON.parse(raw));
  const cues = buildCues(recipe.segments);
  if (cues.length === 0) {
    throw new Error(
      "no captions in this recipe — every segment's caption is empty, so there is " +
        "nothing to write a subtitle track from"
    );
  }

  const outDir = path.join(projectPath, "out");
  const files: string[] = [];
  for (const format of new Set(formats)) {
    const file = path.join(outDir, `reel.${format}`);
    await writeFile(file, format === "srt" ? toSrt(cues) : toVtt(cues));
    files.push(file);
  }

  return {
    files,
    cues: cues.length,
    nextStep:
      "Upload these alongside the mp4 where the platform accepts a subtitle file, or " +
      "keep them as the accessible transcript. Long captions were split into readable " +
      "cues, so the sidecar's line breaks won't always match the burned-in text.",
  };
}
