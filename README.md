# reels-maker

An MCP server that turns "here's my footage, here's my script, make it look like *that* reel" into an actual rendered video.

You give your AI agent (Claude Code, Codex, or anything that speaks [MCP](https://modelcontextprotocol.io)) three things:

1. **Your footage** — screen recording, b-roll, talking head, whatever you shot.
2. **Your script** — the text you want the reel to say (captions, tips, hooks).
3. **A reference reel** — a video whose *style* you want to copy: pacing, transitions, caption rhythm, music vibe.

The server gives the agent the tools to pull that off:

| Tool | What it does |
|------|--------------|
| `analyze_reference` | Probes the reference video: duration, resolution, fps, scene cuts, average shot length, and extracts keyframes at every cut so the agent can *look* at the style. |
| `extract_music` | Rips the audio track out of the reference so the new reel can use the same music. |
| `scaffold_reel` | Generates a ready-to-edit [Remotion](https://remotion.dev) project from a **style recipe** — a JSON description of the reel (segments, captions, transitions, music) that the agent writes after studying the reference. |
| `render_reel` | Renders the Remotion project to an mp4. |

Plus a `reels-maker` **prompt** that shows up as a slash command in Claude Code (`/mcp__reels-maker__reels-maker`) and walks the agent through the full workflow.

## How the workflow feels

```
/reels-maker  my-screen-recording.mov  script.txt  reference-reel.mp4
```

The agent then:

1. Calls `analyze_reference` on the reel you like — gets scene cuts + keyframes.
2. Looks at the keyframes, figures out what's actually going on: "guy coding in the
   background, big center captions, hard cuts every ~1.8s, tips appearing one by one".
3. Calls `extract_music` to grab the soundtrack.
4. Writes a *style recipe* — your footage as the background, your script as the
   captions, the reference's cut timing and transitions.
5. Calls `scaffold_reel` to generate the Remotion project, then `render_reel`.
6. Hands you an mp4.

## Install

Requires: **Node 18+** and **ffmpeg/ffprobe** on your PATH (`brew install ffmpeg`).

```bash
git clone https://github.com/pouyashahrdami/reels-maker
cd reels-maker
npm install
npm run build
```

### Claude Code

```bash
claude mcp add reels-maker -- node /absolute/path/to/reels-maker/dist/index.js
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.reels-maker]
command = "node"
args = ["/absolute/path/to/reels-maker/dist/index.js"]
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
      "image": "/path/to/screenshot.png"  // optional: floating card above the caption
    }
    // ... one segment per shot, timed like the reference
  ]
}
```

`scaffold_reel` validates the recipe and generates a Remotion project you (or the agent) can still tweak by hand before rendering.

## Status

Early. The core loop works: analyze → recipe → scaffold → render. Style coverage (transition types, caption animations) grows as real reference reels hit it. Issues and PRs welcome.

## License

MIT
