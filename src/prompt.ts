/**
 * The workflow prompt exposed as a slash command in MCP clients
 * (Claude Code shows it as /mcp__mimic-mcp__mimic-mcp).
 */
export function mimicMcpPrompt(args: {
  my_video: string;
  script: string;
  reference_video: string;
}): string {
  return `You are making a short vertical reel. Recreate the STYLE of a reference video using the user's own footage and script.

Inputs:
- User's footage: ${args.my_video}
- User's script (text, or a path to a text file — read it if it's a path): ${args.script}
- Reference reel to copy the style from: ${args.reference_video}

Work through these steps in order:

1. Call the analyze_reference tool on the reference video. It returns scene cuts,
   pacing stats, and keyframe image files.

2. Open and LOOK at the extracted frames. Each sampled shot has start/mid/end
   frames — compare them per shot: if the subject grows across the shot it's a
   punch-in zoom (copy it with that segment's \`zoom\`), if the framing slides it's
   a pan. Then describe to yourself what the reference is actually doing: what's
   in the background, where captions sit, how big they are, how often shots
   change, what transitions connect them, the overall mood.

3. If the reference has audio, call extract_music on it to grab the soundtrack.

4. Call draft_recipe with analyze_reference's styleSpecFile, the script split into
   caption lines, the user's footage, and the extracted music. It projects the
   MEASUREMENT into a first-pass recipe — one segment per shot, transition kinds and
   durations copied verbatim, in-shot zoom with its fitted easing, caption band/size/
   style from the OCR track, boundaries snapped to the beat grid. It also measures YOUR
   footage per segment so cover-crops and punch-ins aim at the subject instead of the
   middle of the frame. Do NOT hand-author timing; that is exactly what this tool
   exists to stop you doing.

5. Edit the draft — it wrote a recipe.json you can read and rewrite. Work through its
   \`notes\` first (they list what it deliberately left to you), then the judgment calls
   it cannot measure:
   - caption text per segment, and captionStyle where the draft guessed wrong:
     "hook" for the opener, "tip" for list-style points, "plain" otherwise
   - image (optional, per segment): if the reference floats screenshots/cards over the
     footage, gather or capture the equivalent images for the user's topic and set the
     path here — the caption renders directly below the card, like those reels do
   - typography: match the reference's type from the OCR caption crops. A captionFont
     is only a CSS family name, so ALSO list the family in the recipe's top-level
     \`googleFonts\` — without that the render falls back to Helvetica and no amount of
     other fidelity will make it look like the reference. Reach for \`captionOutline\`
     when the reference's text stays crisp over busy footage, \`captionBackground\` for
     the subtitle-box look, and \`emphasisWords\` when one word carries the line.
   - colors, sound effects on the cuts, captionAnimation
   - beat-flash montages: when the reference cuts extremely fast (sub-second shots
     flipping between two source clips), alternate backgroundVideo/backgroundStart per
     segment so the flashes come off different clips. Off-beat flashing is what makes
     copies feel wrong — the draft already snapped the boundaries to onsets, so keep
     them.
   Leave the measured timing, transitions and zooms alone unless a frame proves them
   wrong. They came from arithmetic; your memory of the frames did not.

6. Call scaffold_reel with the edited recipe and a fresh project directory.

7. Call render_reel on that directory. First render is slow (installs Remotion).
   While iterating afterwards, don't re-render the whole reel to check one fix:
   render_still answers layout questions (caption size, wrapping, position) for the
   price of a single frame, and render_reel with \`segments: [n]\` re-renders just the
   segments you touched. Save the full render for when timing or audio is the question.

8. Review your own work: call review_render with the project directory, the
   reference video, and the \`platform\` the user is posting to (tiktok / instagram /
   youtube-shorts) so captions hidden behind that app's own caption bar and action
   rail get caught — a reel can score 100 on fidelity and still ship unreadable.
   Open each rendered/reference frame pair and compare like an
   editor — caption size and position, card placement, pacing, overall look.
   If something is off, edit recipe.json inside the project and re-render.
   One or two fix rounds is normal; don't loop forever.

9. Tell the user where the mp4 is, summarize the style choices you copied, and offer
   to adjust timings, caption text, or styles — edits go in the project's recipe.json,
   then re-render.

Ask the user before guessing if the script doesn't obviously split into segments, or
if the reference style needs elements the recipe can't express yet (tell them what's
missing).`;
}

/**
 * The from-scratch workflow: no footage required. The agent designs every
 * frame — CSS fills, still images, and custom Remotion scene components it
 * writes itself — instead of overlaying captions on shot video.
 */
export function generateScratchPrompt(args: {
  script: string;
  assets?: string;
  reference_video?: string;
  style?: string;
}): string {
  const reference = args.reference_video
    ? `- Reference video for design inspiration (optional input, provided): ${args.reference_video}`
    : "- No reference video: you are the art director. Commit to one coherent look.";
  const assets = args.assets
    ? `- Assets to build with (screenshots, logos, product shots — a directory or list): ${args.assets}`
    : "- No assets provided: everything on screen is designed by you (fills, typography, scenes).";
  return `You are making a short vertical reel FROM SCRATCH — a graphical product demo /
motion-graphics piece. There is no shot footage. You design every frame.

Inputs:
- Script (text, or a path to a text file — read it if it's a path): ${args.script}
${assets}
${reference}
${args.style ? `- Style direction from the user: ${args.style}` : ""}

The recipe gives a from-scratch segment three background sources (mutually exclusive
per segment, freely mixable across segments — footage segments can sit alongside):
- backgroundFill: a CSS color/gradient canvas. Cheap, clean, great under big type.
- backgroundImage: a full-bleed still (product screenshot, designed frame). Add
  \`zoom\` for the Ken-Burns product-demo move; videoTransitionIn works too.
- scene: a Remotion component YOU write — the powerful one. Animated UI mockups,
  charts drawing themselves, feature callouts, device frames, motion graphics.

Work through these steps in order:

1. If there's a reference video, call analyze_reference and study the frames as a
   DESIGN BRIEF, not something to overlay on: per shot, note the palette, where text
   sits, what elements are on screen, what enters/exits and how (shots[].motion has
   fitted easing; captions[] has measured text position/size). You'll rebuild the
   pages, not copy pixels. Optionally extract_music for the soundtrack.

2. Look at any assets (open the images). Then storyboard: split the script into
   pages — for each, decide background source, on-screen elements, and the one
   motion that sells it. Sub-2s pages with one idea each beat long static pages.

3. For pages needing real animation, write scene components. The contract:
   - A .tsx file default-exporting a React component taking SceneProps
     (import type { SceneProps } from "../recipeSchema").
   - Animate with useCurrentFrame() (segment-relative) against durationInFrames;
     use interpolate/spring from "remotion". Import ONLY "react", "remotion",
     and files inside the project — the scaffolded project has no other deps.
   - Images inside a scene: copy the file into the project's public/ after
     scaffolding and reference it with staticFile("name.png").
   - The scene is the segment's whole background; recipe captions, sounds, zoom
     and transitions still layer on top — don't re-render the caption yourself.

4. Sound: generate_voiceover for narration (transcribe it for karaoke wordTimings),
   extracted or user-provided music, and per-segment sound effects ("pop", "whoosh")
   on the cuts. Silent reels feel broken; always give the reel audio. Narration goes
   in the recipe's \`voiceover\` field and music in \`music\` — they play together and
   the music ducks itself under the voice. Set voiceover.durationSeconds so the duck
   releases when the narration actually stops.

5. Write the recipe: segments with fills/images/scenes, captions timed to the
   voiceover or music beats, videoTransitionIn between design pages (dissolves and
   dips read as intentional; hard cuts work when the music is punchy). Commit to a
   typeface: list it in the recipe's top-level \`googleFonts\` and set it as each
   segment's \`captionFont\` — the default sans is the fastest way to look templated.

6. scaffold_reel with the recipe (scene paths go in each segment's \`scene\` field —
   they get copied into src/scenes/ automatically). Then render_reel with
   quality:"draft" while iterating.

7. review_render (no reference needed — you get one frame per segment). Critique
   your own design like an art director: is the type hierarchy clear, is anything
   clipped, does each page have one focal point, do colors hold together across
   pages? Fix recipe.json or the scene files in src/scenes/ and re-render. With a
   reference, also weigh the measured fidelity report — but for from-scratch work
   your design judgment outranks the score.

8. render_reel quality:"final", then tell the user where the mp4 is, what design
   system you committed to, and offer open_in_studio for hand-tuning.

Ask the user before guessing if the script doesn't split into pages, or if they'd
rather supply screenshots for a page you're about to fake with a mockup.`;
}
