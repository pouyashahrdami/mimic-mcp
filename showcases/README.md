# Showcases

Reels made with mimic-mcp — by the maintainer and by you. This folder is the
gallery the [website](https://pouyashahrdami.github.io/mimic-mcp/) pulls from.

| Reel | Workflow | Made by | Notes |
|------|----------|---------|-------|
| [mimic-ad-from-scratch.mp4](mimic-ad-from-scratch.mp4) | `generate-scratch` | [@pouyashahrdami](https://github.com/pouyashahrdami) | A SaaS-ad style reel built with **zero footage**: a reference ad analyzed as a design brief, then four agent-written Remotion scenes (feature pills, rings interlude, terminal product shot, wordmark finale), gradient statement pages, and cut timings copied from the measured reference. |

## Add yours

PRs welcome — a showcase is one video plus one table row:

1. Drop the mp4 in this folder, kebab-case name, **under ~5 MB** (draft quality or
   a short excerpt is fine).
2. **Strip or replace the audio unless you own it** — reference soundtracks are
   usually copyrighted: `ffmpeg -i reel.mp4 -an -c:v copy showcase.mp4`.
3. Add a row: which workflow (`mimic-mcp` style copy or `generate-scratch`), who
   you are, and a sentence on what the agent actually did.

Don't include the reference video you copied from — just your result.
