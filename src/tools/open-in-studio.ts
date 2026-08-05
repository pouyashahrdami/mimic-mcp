import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * The local server URL in Remotion Studio's startup output. Deliberately
 * anchored to localhost/127.0.0.1 — the banner also prints docs links, which
 * a bare URL regex happily grabs first.
 */
export function parseStudioUrl(output: string): string | null {
  const match = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\S*/);
  return match ? match[0].replace(/[),.]+$/, "") : null;
}

/**
 * Launch Remotion Studio for a scaffolded project and hand back its URL.
 * Studio is the human half of the workflow: the user scrubs the timeline,
 * edits any recipe field in the right-hand props panel (the composition is
 * zod-schema'd), and exports — no code required. The process keeps running
 * after this returns; it belongs to the user now.
 */
export async function openInStudio(
  projectDir: string
): Promise<{ url: string; pid: number; note: string }> {
  await access(path.join(projectDir, "recipe.json")).catch(() => {
    throw new Error(
      `${projectDir} doesn't look like a scaffolded reel project (no recipe.json). Run scaffold_reel first.`
    );
  });

  const hasDeps = await access(path.join(projectDir, "node_modules"))
    .then(() => true)
    .catch(() => false);
  if (!hasDeps) {
    await run("npm", ["install", "--no-fund", "--no-audit"], {
      cwd: projectDir,
      maxBuffer: MAX_BUFFER,
    });
  }

  const child = spawn("npx", ["remotion", "studio"], {
    cwd: projectDir,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const url = await new Promise<string>((resolve, reject) => {
    let collected = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `Remotion Studio didn't report a URL within 90s. Output so far:\n${collected.slice(-2000)}`
        )
      );
    }, 90_000);

    const onData = (chunk: Buffer) => {
      collected += chunk.toString();
      const found = parseStudioUrl(collected);
      if (found) {
        clearTimeout(timer);
        // Stop consuming output so the detached process can outlive us.
        child.stdout?.removeListener("data", onData);
        child.stderr?.removeListener("data", onData);
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
        resolve(found);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(`Remotion Studio exited (code ${code}) before serving:\n${collected.slice(-2000)}`)
      );
    });
  });

  return {
    url,
    pid: child.pid ?? -1,
    note:
      "Studio is running — open the URL to preview the reel, edit any recipe field in the " +
      "right-hand props panel, and export from the Render button. It keeps running until you " +
      `stop it (kill ${child.pid}).`,
  };
}
