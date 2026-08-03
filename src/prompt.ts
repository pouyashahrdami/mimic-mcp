/**
 * The workflow prompt exposed as a slash command in MCP clients
 * (Claude Code shows it as /mcp__reels-maker__reels-maker).
 */
export function reelsMakerPrompt(args: {
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

2. Open and LOOK at the keyframe images. Describe to yourself what the reference is
   actually doing: what's in the background, where captions sit, how big they are,
   how often shots change, what transitions connect them, the overall mood.

3. If the reference has audio, call extract_music on it to grab the soundtrack.

4. Write a style recipe (JSON) that transfers that style onto the user's inputs:
   - background.video = the user's footage
   - segments = the user's script split into caption beats, TIMED LIKE THE REFERENCE
     (match its average shot length and rhythm, not evenly spaced)
   - captionStyle per segment: "hook" for the opener, "tip" for list-style points,
     "plain" otherwise — pick based on what the reference does
   - transitionIn: match the reference (hard cuts -> "cut", soft -> "fade"/"slide")
   - image (optional, per segment): if the reference floats screenshots/cards over the
     footage, gather or capture the equivalent images for the user's topic and set the
     path here — the caption renders directly below the card, like those reels do
   - music = the extracted soundtrack, unless the user said otherwise
   - output dimensions 1080x1920 @ 30fps unless the reference clearly differs
   - durationSeconds: long enough for all segments, no longer than the music needs

5. Call scaffold_reel with the recipe and a fresh project directory.

6. Call render_reel on that directory. First render is slow (installs Remotion).

7. Review your own work: call review_render with the project directory AND the
   reference video. Open each rendered/reference frame pair and compare like an
   editor — caption size and position, card placement, pacing, overall look.
   If something is off, edit recipe.json inside the project and re-render.
   One or two fix rounds is normal; don't loop forever.

8. Tell the user where the mp4 is, summarize the style choices you copied, and offer
   to adjust timings, caption text, or styles — edits go in the project's recipe.json,
   then re-render.

Ask the user before guessing if the script doesn't obviously split into segments, or
if the reference style needs elements the recipe can't express yet (tell them what's
missing).`;
}
