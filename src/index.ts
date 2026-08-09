#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyzeReference } from "./tools/analyze-reference.js";
import { extractMusic } from "./tools/extract-music.js";
import { trimSilenceTool } from "./tools/trim-silence.js";
import { exportVariants } from "./tools/export-variants.js";
import { listPresets, getPreset, savePreset } from "./presets.js";
import { transcribeReference } from "./tools/transcribe-reference.js";
import { generateVoiceover } from "./tools/generate-voiceover.js";
import { draftRecipeTool } from "./tools/draft-recipe.js";
import { scaffoldReel } from "./tools/scaffold-reel.js";
import { renderReel } from "./tools/render-reel.js";
import { reviewRender } from "./tools/review-render.js";
import { openInStudio } from "./tools/open-in-studio.js";
import { generateScratchPrompt, mimicMcpPrompt } from "./prompt.js";

const server = new McpServer({ name: "mimic-mcp", version: "0.1.0" });

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
      "Extracts start/mid/end frames per shot so you can look at the style AND spot in-shot " +
      "motion (punch-in zooms, pans) by comparing a shot's frames. " +
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
  "generate_voiceover",
  {
    title: "Generate voiceover",
    description:
      "Turn a script into a spoken voiceover audio track using the built-in macOS voice (no API key). " +
      "Use the returned file as the recipe's audio track; transcribe it for karaoke word timings. " +
      "macOS only.",
    inputSchema: {
      script: z.string().describe("The narration text, or a path to a .txt/.md file"),
      voice: z
        .string()
        .optional()
        .describe("System voice name, e.g. \"Samantha\" or \"Daniel\". Omit for the default."),
      rate: z
        .number()
        .optional()
        .describe("Speaking rate in words per minute (e.g. 180). Omit for the default."),
    },
  },
  async ({ script, voice, rate }) => {
    try {
      return ok(await generateVoiceover(script, workDir, { voice, rate }));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "transcribe_reference",
  {
    title: "Transcribe reference reel",
    description:
      "Transcribe the reference's spoken audio with word-level timings, so you can see its script " +
      "structure (hook → build → payoff), not just its visuals. Each segment's wordTimings are " +
      "segment-relative and drop straight into a karaoke caption. Requires a local whisper CLI " +
      "(e.g. `uv tool install whisper-ctranslate2`).",
    inputSchema: {
      video: z.string().describe("Absolute path to the reference video"),
      model: z
        .string()
        .optional()
        .describe("Whisper model size: tiny/base (fast) … small/medium (sharper). Default base."),
    },
  },
  async ({ video, model }) => {
    try {
      return ok(await transcribeReference(video, model));
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
  "trim_silence",
  {
    title: "Trim silence (jump-cut)",
    description:
      "Cut the silent gaps out of talking-head footage, concatenating the spoken parts into a " +
      "tighter jump-cut clip. Run this on raw footage first, then use the returned path as " +
      "background.video. Returns how much was removed.",
    inputSchema: {
      video: z.string().describe("Absolute path to the footage to tighten"),
      threshold_db: z
        .number()
        .optional()
        .describe("Loudness (dBFS) below which audio is silence. Default -30; lower = stricter."),
      min_silence_seconds: z
        .number()
        .optional()
        .describe("Minimum gap length to cut, in seconds. Default 0.5."),
    },
  },
  async ({ video, threshold_db, min_silence_seconds }) => {
    try {
      return ok(
        await trimSilenceTool(video, workDir, {
          thresholdDb: threshold_db,
          minSilenceSeconds: min_silence_seconds,
        })
      );
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "draft_recipe",
  {
    title: "Draft a recipe from the measured style spec",
    description:
      "Project an analyzed reference into a first-pass style recipe: one segment per measured " +
      "shot, transitions and durations copied verbatim from the fingerprints, in-shot zoom with " +
      "its fitted easing, caption band/size/style from the OCR track, boundaries snapped to the " +
      "beat grid. Call this after analyze_reference INSTEAD of hand-authoring timing — then edit " +
      "the draft for content and look. Returns the recipe, the file it wrote, and `notes`: the " +
      "judgment calls left to you.",
    inputSchema: {
      script: z
        .union([z.array(z.string()), z.string()])
        .describe(
          "Caption lines in reel order — an array, a newline-separated string, or a path to a " +
            ".txt/.md file. Lines land on the shots that showed text in the reference."
        ),
      style_spec: z
        .string()
        .optional()
        .describe("Path to a style-spec.json from analyze_reference (styleSpecFile in its result)"),
      reference: z
        .string()
        .optional()
        .describe(
          "Reference video, as an alternative to style_spec — its cached spec is reused when " +
            "present, otherwise it is analyzed now (slower)."
        ),
      footage: z.string().optional().describe("Absolute path to the user's footage"),
      background_fill: z
        .string()
        .optional()
        .describe("CSS color or gradient for a from-scratch reel with no footage"),
      music: z.string().optional().describe("Absolute path to the soundtrack (e.g. from extract_music)"),
      snap_to_beats: z
        .boolean()
        .optional()
        .describe("Nudge segment boundaries onto the measured beats. Default true."),
      out: z.string().optional().describe("Where to write recipe.json. Default <cwd>/recipe.json"),
    },
  },
  async ({ script, style_spec, reference, footage, background_fill, music, snap_to_beats, out }) => {
    try {
      return ok(
        await draftRecipeTool(
          {
            script,
            styleSpec: style_spec,
            reference,
            footage,
            backgroundFill: background_fill,
            music,
            snapToBeats: snap_to_beats,
            out,
          },
          workDir
        )
      );
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
      "Copies footage, images, music and custom scene components (.tsx) into the project. " +
      "Footage is optional — segments can run on CSS fills, still images, or scenes you " +
      "write, for fully generated reels. See the mimic-mcp / generate-scratch prompts or " +
      "README for the recipe format.",
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
      "critique the result, fix recipe.json, and re-render. Works without a reference too " +
      "(from-scratch reels): you get the per-segment frames to critique against your own design intent.",
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

server.registerTool(
  "open_in_studio",
  {
    title: "Open in Remotion Studio",
    description:
      "Launch Remotion Studio for a scaffolded project and return its URL — the human handoff. " +
      "The user can preview the reel, tweak every recipe field in Studio's props panel (captions, " +
      "timing, zooms, transitions, colors), and export the final video themselves. " +
      "Call this when the reel is close and the user wants to fine-tune or export interactively.",
    inputSchema: {
      project_dir: z.string().describe("A directory created by scaffold_reel"),
    },
  },
  async ({ project_dir }) => {
    try {
      return ok(await openInStudio(project_dir));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "export_variants",
  {
    title: "Export aspect-ratio variants",
    description:
      "Re-frame a rendered reel into other aspect ratios for cross-posting. " +
      "Formats: reels (9:16), square (1:1), feed (4:5), youtube (16:9). " +
      "mode 'crop' fills the frame (loses edges); 'pad' keeps everything on a blurred background.",
    inputSchema: {
      video: z.string().describe("Path to the rendered reel (e.g. out/reel.mp4)"),
      formats: z
        .array(z.enum(["reels", "square", "feed", "youtube"]))
        .min(1)
        .describe("Which aspect ratios to export"),
      mode: z
        .enum(["crop", "pad"])
        .default("crop")
        .describe("crop = fill & center-crop; pad = fit whole frame on a blurred background"),
    },
  },
  async ({ video, formats, mode }) => {
    try {
      return ok(await exportVariants(video, formats, mode));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "list_presets",
  {
    title: "List style presets",
    description:
      "List available reel style presets — shipped built-ins plus any you've saved. A preset is a " +
      "reusable look (caption styles, animations, transitions, zoom, timing) with no content. " +
      "Use get_preset to fetch one and fill it with your footage and script.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await listPresets(workDir));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "get_preset",
  {
    title: "Get style preset",
    description:
      "Fetch a preset's full style skeleton by name. Use it as the template for a new recipe: keep " +
      "its segment styles/timing, add your background.video, music, and caption text per segment.",
    inputSchema: { name: z.string().describe("Preset name from list_presets") },
  },
  async ({ name }) => {
    try {
      return ok(await getPreset(workDir, name));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "save_preset",
  {
    title: "Save style preset",
    description:
      "Extract the reusable style from a recipe (dropping footage paths, caption text and music) and " +
      "save it as a named preset you can reapply to future reels. Great after you nail a look.",
    inputSchema: {
      recipe_json: z.string().describe("The recipe whose style you want to keep, as a JSON string"),
      name: z.string().describe("Short name for the preset, e.g. \"my-listicle\""),
      description: z.string().describe("One line describing the look, for list_presets"),
    },
  },
  async ({ recipe_json, name, description }) => {
    try {
      return ok(await savePreset(recipe_json, name, description, workDir));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerPrompt(
  "mimic-mcp",
  {
    title: "mimic-mcp",
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
        content: { type: "text" as const, text: mimicMcpPrompt(args) },
      },
    ],
  })
);

server.registerPrompt(
  "generate-scratch",
  {
    title: "generate-scratch",
    description:
      "From-scratch workflow: design and render a fully generated reel (product demo, " +
      "motion graphics) with no footage — fills, images, and custom Remotion scenes.",
    argsSchema: {
      script: z.string().describe("Your script text, or a path to a text file"),
      assets: z
        .string()
        .optional()
        .describe("Optional: directory or comma-separated files (screenshots, logo, product shots)"),
      reference_video: z
        .string()
        .optional()
        .describe("Optional: a video to study as design inspiration (not to overlay on)"),
      style: z
        .string()
        .optional()
        .describe("Optional: style direction, e.g. \"dark, neon, techy\" or \"clean editorial\""),
    },
  },
  (args) => ({
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text: generateScratchPrompt(args) },
      },
    ],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
