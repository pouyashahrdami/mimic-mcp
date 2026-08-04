#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyzeReference } from "./tools/analyze-reference.js";
import { extractMusic } from "./tools/extract-music.js";
import { scaffoldReel } from "./tools/scaffold-reel.js";
import { renderReel } from "./tools/render-reel.js";
import { reviewRender } from "./tools/review-render.js";
import { reelsMakerPrompt } from "./prompt.js";

const server = new McpServer({ name: "reels-maker", version: "0.1.0" });

// Analysis artifacts (frames, extracted audio) land under the client's cwd.
const workDir = process.cwd();

function ok(result: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
      },
    ],
  };
}

function fail(err: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ],
    isError: true,
  };
}

server.registerTool(
  "analyze_reference",
  {
    title: "Analyze reference reel",
    description:
      "Probe a reference video: duration, resolution, fps, scene cuts, average shot length. " +
      "Extracts keyframe images at each shot so you can look at the style. " +
      "Returns JSON with paths to the extracted frames — open them.",
    inputSchema: { video: z.string().describe("Absolute path to the reference video") },
  },
  async ({ video }) => {
    try {
      return ok(await analyzeReference(video, workDir));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "extract_music",
  {
    title: "Extract music",
    description:
      "Extract the audio track from a video into an .m4a file. Returns the path to use in the recipe's music.file.",
    inputSchema: { video: z.string().describe("Absolute path to the video") },
  },
  async ({ video }) => {
    try {
      return ok({ musicFile: await extractMusic(video, workDir) });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "scaffold_reel",
  {
    title: "Scaffold Remotion project",
    description:
      "Generate a self-contained Remotion project from a style recipe (JSON string). " +
      "Copies the background footage and music into the project. " +
      "See the reels-maker prompt or README for the recipe format.",
    inputSchema: {
      recipe_json: z.string().describe("The style recipe as a JSON string"),
      project_dir: z.string().describe("Directory to create the project in (should not exist yet or be empty)"),
    },
  },
  async ({ recipe_json, project_dir }) => {
    try {
      return ok(await scaffoldReel(recipe_json, project_dir));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "render_reel",
  {
    title: "Render reel",
    description:
      "Render a scaffolded project to mp4. Slow on first run (installs Remotion + headless Chromium). " +
      "Pass quality:'draft' for a fast half-resolution preview while iterating on the recipe, " +
      "then quality:'final' (the default) for the deliverable.",
    inputSchema: {
      project_dir: z.string().describe("A directory created by scaffold_reel"),
      quality: z
        .enum(["draft", "final"])
        .default("final")
        .describe(
          "draft = half-resolution, fast encode to out/reel-draft.mp4 for quick review loops. " +
            "final = full-quality deliverable to out/reel.mp4."
        ),
    },
  },
  async ({ project_dir, quality }) => {
    try {
      return ok({ output: await renderReel(project_dir, quality) });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "review_render",
  {
    title: "Review rendered reel",
    description:
      "Extract one frame per segment from the rendered reel — paired with frames from the same " +
      "relative position in the reference video, when given — so you can compare them side by side, " +
      "critique the result, fix recipe.json, and re-render.",
    inputSchema: {
      project_dir: z.string().describe("A directory rendered by render_reel"),
      reference_video: z
        .string()
        .optional()
        .describe("Path to the original reference video, for side-by-side comparison"),
    },
  },
  async ({ project_dir, reference_video }) => {
    try {
      return ok(await reviewRender(project_dir, reference_video));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerPrompt(
  "reels-maker",
  {
    title: "Reels maker",
    description:
      "Full workflow: study a reference reel, then recreate its style with your footage and script.",
    argsSchema: {
      my_video: z.string().describe("Path to your footage"),
      script: z.string().describe("Your script text, or a path to a text file"),
      reference_video: z.string().describe("Path to the reel whose style you want"),
    },
  },
  (args) => ({
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text: reelsMakerPrompt(args) },
      },
    ],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
