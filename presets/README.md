# Presets

A preset is a reusable **look** with no content — caption styles, animations,
transitions, zoom, and timing, but no footage, text, or music. The agent applies one
to a fresh script + footage to reproduce a style it (or you) nailed before.

This folder holds the shipped built-ins. Your own presets, saved via the `save_preset`
tool, live alongside them in your working directory and win over a built-in of the
same name.

## Adding one

Copy an existing file, rename it, and edit the fields. The filename should match the
`name`. `npm test` validates every preset in this folder against the schema, so run it
before opening a PR — see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Schema

```jsonc
{
  "name": "bold-hook-tips",          // required — unique, matches the filename
  "description": "...",              // required — what the look is and when to reach for it
  "output": { "width": 1080, "height": 1920, "fps": 30 },  // required
  "musicVolume": 0.85,               // optional, 0–1
  "segments": [                      // required, at least one
    {
      "durationSeconds": 2.2,        // required, > 0
      "captionStyle": "hook",        // required — "hook" | "tip" | "plain"
      "captionAnimation": "karaoke", // optional — "none" | "karaoke" | "typewriter"
      "captionPosition": "center",   // optional — "top" | "center" | "bottom"
      "transitionIn": "cut",         // optional — "cut" | "fade" | "slide"
      "highlightColor": "#ffe000",   // optional — active-word color for karaoke
      "captionColor": "#ffffff",     // optional
      "captionFont": "Inter",        // optional
      "captionSize": 72,             // optional, > 0
      "captionWeight": 800,          // optional, 100–900
      "zoom": {                      // optional — Ken-Burns punch-in
        "from": 1, "to": 1.2,
        "easing": "easeOut",         // "linear" | "easeIn" | "easeOut" | "easeInOut"
        "focusX": 0.5, "focusY": 0.4 // 0–1
      }
    }
    // ... one segment per shot, timed like the reference
  ]
}
```

A preset is deliberately a subset of the [style recipe](../README.md#the-style-recipe):
the styling fields, with the content fields (captions, background video, images, sound,
music file, word timings) stripped out. `save_preset` does that stripping for you.

## What makes a good preset

- A recognizable, reusable *feel* — not one specific reel. Name and describe it so the
  agent knows when to reach for it.
- A `description` that says what the look is **and** when to use it (see the built-ins).
- Enough segments to convey the rhythm (a hook plus a few beats), but no more.
