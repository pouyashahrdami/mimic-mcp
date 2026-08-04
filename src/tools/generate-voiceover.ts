import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { synthesizeVoiceover, type Voiceover } from "../tts.js";

/** Treat the script as a file path when it points at a real .txt, else literal text. */
async function resolveText(scriptOrPath: string): Promise<string> {
  if (/\.(txt|md)$/i.test(scriptOrPath.trim())) {
    try {
      return (await readFile(scriptOrPath, "utf8")).trim();
    } catch {
      // Not a readable file — fall through and treat it as literal text.
    }
  }
  return scriptOrPath;
}

/**
 * Generate a spoken voiceover from a script and drop it in `.reels-maker/` so
 * the agent can wire it into a recipe as the audio track. Output filename is
 * content-addressed so re-running with the same script/voice is idempotent.
 */
export async function generateVoiceover(
  scriptOrPath: string,
  workDir: string,
  options: { voice?: string; rate?: number } = {}
): Promise<Voiceover & { nextStep: string }> {
  const text = await resolveText(scriptOrPath);
  if (!text.trim()) throw new Error("Script is empty — nothing to narrate.");

  const outDir = path.join(workDir, ".reels-maker", "voiceover");
  await mkdir(outDir, { recursive: true });

  const hash = createHash("sha1")
    .update(`${text}|${options.voice ?? ""}|${options.rate ?? ""}`)
    .digest("hex")
    .slice(0, 8);
  const outPath = path.join(outDir, `vo-${hash}.m4a`);

  const vo = await synthesizeVoiceover(text, outPath, options);

  return {
    ...vo,
    nextStep:
      `Voiceover is ${vo.durationSeconds}s. Use it as music.file in the recipe (it's your narration track), ` +
      `set output.durationSeconds to at least ${vo.durationSeconds}, and lay captions over it. ` +
      `For word-synced karaoke captions, run transcribe_reference on this file to get wordTimings.`,
  };
}
