# mimic-mcp

An MCP server that turns "here's my footage, here's my script, make it look like *that* reel" into an actual rendered video.

Your agent can already **see** — this gives it **hands** for making reels. It studies a reel you like frame by frame, clones the style onto your footage, renders it with [Remotion](https://remotion.dev), then critiques its own render against the reference and fixes what's off.

![reference reel next to the generated reel](assets/demo.gif)

*Left: a reel the user liked (someone else's, about API resources). Right: what the agent generated from the user's own footage and a one-line script about AI models — same pacing, same layout, same music.*

You give your AI agent (Claude Code, Codex, or anything that speaks [MCP](https://modelcontextprotocol.io)) three things:

1. **Your footage** — screen recording, b-roll, talking head, whatever you shot.
2. **Your script** — the text you want the reel to say (captions, tips, hooks).
3. **A reference reel** — a video whose *style* you want to copy: pacing, transitions, caption rhythm, music vibe.

The server gives the agent the tools to pull that off:

**Study the reference**

| Tool | What it does |
|------|--------------|
| `analyze_reference` | Probes the reference video: duration, resolution, fps, scene cuts (adaptively thresholded, each classified as a **hard cut or fade/dissolve**), average shot length, and **musical beat/onset timestamps (with a BPM estimate)** so cuts can land on the beat. Extracts start/mid/end frames per shot so the agent can *look* at the style and spot in-shot motion (punch-in zooms, pans) by comparing a shot's frames. |
| `transcribe_reference` | Transcribes the reference's spoken audio with **word-level timings**, so the agent sees its *script structure* (hook → build → payoff), not just its visuals. Word timings drop straight into karaoke captions. Needs a local whisper CLI. |
| `extract_music` | Rips the audio track out of the reference so the new reel can use the same music. |

**Prep your footage**

| Tool | What it does |
|------|--------------|
| `trim_silence` | Cuts the silent gaps out of talking-head footage, concatenating the spoken parts into a tighter jump-cut clip — the tedious pass, automated. |
| `generate_voiceover` | Turns a script into a spoken voiceover track using the built-in macOS voice (no API key). Transcribe it for word-synced karaoke captions. macOS only. |

**Build & render**

| Tool | What it does |
|------|--------------|
| `scaffold_reel` | Generates a ready-to-edit [Remotion](https://remotion.dev) project from a **style recipe** — a JSON description of the reel (segments, captions, animations, transitions, zoom, sound, music) that the agent writes after studying the reference. |
| `render_reel` | Renders the Remotion project to an mp4. Pass `quality: "draft"` for a fast half-resolution preview while iterating, `"final"` for the deliverable. |
| `review_render` | Extracts one frame per segment from the render, paired with the same relative moment in the reference — so the agent can compare them side by side, catch what's off, and fix its own recipe. |
| `export_variants` | Re-frames the finished reel into other aspect ratios (9:16, 1:1, 4:5, 16:9) for cross-posting — center-crop or blur-padded. |

**Reusable styles**

| Tool | What it does |
|------|--------------|
| `list_presets` / `get_preset` | Browse and fetch style presets — shipped built-ins plus your own — a reusable look (caption styles, animations, transitions, zoom, timing) with no content. |
| `save_preset` | Capture the style of a recipe you nailed (dropping footage, text and music) as a named preset to reapply to future reels. |

Plus a `mimic-mcp` **prompt** that shows up as a slash command in Claude Code (`/mcp__mimic-mcp__mimic-mcp`) and walks the agent through the full workflow.

## How the workflow feels

```
/mimic-mcp  my-screen-recording.mov  script.txt  reference-reel.mp4
```

The agent then:

1. Calls `analyze_reference` on the reel you like — gets scene cuts + per-shot frames.
2. Looks at the frames, figures out what's actually going on: "guy coding in the
   background, big center captions, hard cuts every ~1.8s, tips appearing one by one".
3. Calls `extract_music` to grab the soundtrack.
4. Writes a *style recipe* — your footage as the background, your script as the
   captions, the reference's cut timing and transitions.
5. Calls `scaffold_reel` to generate the Remotion project, then `render_reel`.
6. Calls `review_render` and *looks at its own output* next to the reference:
   "the reference opens with a text-only hook before the cards — mine doesn't."
   Fixes the recipe, re-renders. (This catch actually happened in testing.)
7. Hands you an mp4.

## Install

Requires: **Node 18+** and **ffmpeg/ffprobe** on your PATH (`brew install ffmpeg`).

Optional: a local **whisper CLI** for `transcribe_reference` (`uv tool install whisper-ctranslate2` — light, no torch, or `pip install openai-whisper`). `generate_voiceover` uses macOS's built-in `say`, so it's macOS-only; every other tool is cross-platform.

```bash
git clone https://github.com/pouyashahrdami/mimic-mcp
cd mimic-mcp
npm install
npm run build
```

### Claude Code

```bash
claude mcp add mimic-mcp -- node /absolute/path/to/mimic-mcp/dist/index.js
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.mimic-mcp]
command = "node"
args = ["/absolute/path/to/mimic-mcp/dist/index.js"]
```

### Anything else

It's a standard stdio MCP server: `node dist/index.js`.

## The style recipe

The recipe is the contract between "agent understands the reference" and "code renders the video". It's plain JSON:

```jsonc
{
  "output": { "width": 1080, "height": 1920, "fps": 30, "durationSeconds": 24 },
  "background": { "video": "/path/to/my-footage.mov", "fit": "cover" },
  "music": { "file": "/path/to/extracted-music.m4a", "volume": 0.8 },
  "segments": [
    {
      "start": 0, "end": 2.1,
      "caption": "3 tools that changed how I code",
      "captionStyle": "hook",          // hook | tip | plain
      "transitionIn": "cut",           // cut | fade | slide
      "captionAnimation": "karaoke",   // none | karaoke | typewriter
      "highlightColor": "#ffe000",     // active-word color for karaoke
      "wordTimings": [0, 0.4, 0.7],    // optional per-word times (from transcribe_reference)
      "sound": "whoosh",               // pop | click | whoosh | riser, or a path
      "zoom": { "from": 1, "to": 1.3, "focusX": 0.5, "focusY": 0.4 }, // Ken-Burns punch-in
      "backgroundVideo": "/path/to/clip-2.mov",  // optional: this segment's own clip (montage)
      "backgroundStart": 4.0,          // optional: seconds into the clip to start
      "image": "/path/to/screenshot.png"  // optional: floating card above the caption
    }
    // ... one segment per shot, timed like the reference
  ]
}
```

Every field past `caption`/`captionStyle` is optional — a minimal segment is just start/end/caption. `scaffold_reel` validates the recipe and generates a Remotion project you (or the agent) can still tweak by hand before rendering.

## Status

The core loop works end to end: analyze → recipe → scaffold → render → self-review. Style coverage is broad — karaoke/typewriter caption animations, Ken-Burns zoom punch-ins, multi-clip montages, beat detection, transition sound effects, aspect-ratio exports, reusable style presets, silence trimming, transcription and voiceover. Growing as real reference reels hit it. Issues and PRs welcome — the `presets/` folder is an easy first contribution.

## License

MIT
