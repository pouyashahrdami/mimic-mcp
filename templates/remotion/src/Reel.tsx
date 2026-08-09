import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  cancelRender,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { getAvailableFonts } from "@remotion/google-fonts";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { Overlay, Recipe, Segment, VideoTransition, Zoom } from "./recipeSchema";
import { duckWindow, musicGain } from "./audio";
import { scenes } from "./scenes";

const TRANSITION_FRAMES = 12;
const DEFAULT_HIGHLIGHT = "#ffe000";
/**
 * Default caption insets, as a fraction of frame height. A bottom caption has
 * to finish above the platform's caption bar (TikTok's starts ~0.82 down,
 * Instagram's ~0.80), and a top one has to start below the tab bar (~0.08).
 */
const BOTTOM_INSET = 0.2;
const TOP_INSET = 0.12;

/**
 * Load the recipe's Google Fonts before the first frame is captured.
 *
 * A captionFont is just a CSS family name, so without this the render falls
 * back to Helvetica whenever the family isn't installed on the machine — which
 * is nearly always. delayRender holds the render until the webfonts are ready;
 * a family that doesn't exist cancels the render with the near-misses listed,
 * rather than quietly producing a reel in the wrong typeface.
 */
const useGoogleFonts = (families: string[] | undefined): void => {
  const wanted = families ?? [];
  const key = wanted.join(",");
  const [handle] = useState(() =>
    wanted.length > 0 ? delayRender(`Loading Google Fonts: ${key}`) : null
  );

  useEffect(() => {
    if (handle === null) return;
    const available = getAvailableFonts();
    Promise.all(
      wanted.map(async (family) => {
        const entry = available.find((f) => f.fontFamily === family);
        if (!entry) {
          // Substring matching alone never fires on the common case — a typo —
          // so also accept families sharing the first few characters.
          const needle = family.toLowerCase().replace(/\s+/g, "");
          const near = available
            .filter((f) => {
              const name = f.fontFamily.toLowerCase().replace(/\s+/g, "");
              return (
                name.includes(needle) ||
                needle.includes(name) ||
                name.slice(0, 4) === needle.slice(0, 4)
              );
            })
            .slice(0, 5)
            .map((f) => f.fontFamily);
          throw new Error(
            `googleFonts: "${family}" is not a Google Fonts family` +
              (near.length > 0 ? `. Did you mean: ${near.join(", ")}?` : "")
          );
        }
        const font = await entry.load();
        await font.loadFont().waitUntilDone();
      })
    ).then(
      () => continueRender(handle),
      (err: Error) => cancelRender(err)
    );
    // `key` stands in for the array so a new array with the same families
    // doesn't re-trigger the load on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, key]);
};

// Split a caption into words, each tagged with the frame it "lands" on. Timings
// come either from the recipe (wordTimings, in seconds from segment start) or,
// when absent, are spread evenly across the segment — so karaoke works with zero
// extra data and gets tighter the moment a transcription supplies real timings.
function timedWords(
  caption: string,
  durationInFrames: number,
  fps: number,
  wordTimings?: number[]
): { word: string; startFrame: number }[] {
  const words = caption.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return words.map((word, i) => {
    const startFrame =
      wordTimings && wordTimings[i] != null
        ? Math.round(wordTimings[i] * fps)
        : Math.round((i / words.length) * durationInFrames);
    return { word, startFrame };
  });
}

// The three caption looks the recipe can ask for. Tweak freely — this file
// belongs to your project after scaffolding, not to mimic-mcp.
const captionLooks: Record<string, CSSProperties> = {
  hook: {
    fontSize: 82,
    fontWeight: 800,
    textAlign: "center",
    lineHeight: 1.15,
    textShadow: "0 4px 24px rgba(0,0,0,0.85)",
  },
  tip: {
    fontSize: 52,
    fontWeight: 700,
    textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 24,
    padding: "24px 36px",
  },
  plain: {
    fontSize: 58,
    fontWeight: 600,
    textAlign: "center",
    textShadow: "0 3px 16px rgba(0,0,0,0.8)",
  },
};

// Renders the caption text, honoring captionAnimation. Static "none" returns the
// plain string; karaoke highlights each word as it lands; typewriter reveals the
// caption character-by-character.
const CaptionText = ({
  segment,
  durationInFrames,
}: {
  segment: Segment;
  durationInFrames: number;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const animation = segment.captionAnimation ?? "none";
  const wordTimings = segment.wordTimings;
  const emphasis = new Set(segment.emphasisWords ?? []);
  const emphasisColor = segment.emphasisColor ?? DEFAULT_HIGHLIGHT;

  if (animation === "karaoke") {
    const highlight =
      segment.highlightColor ?? DEFAULT_HIGHLIGHT;
    const words = timedWords(segment.caption, durationInFrames, fps, wordTimings);
    return (
      <>
        {words.map(({ word, startFrame }, i) => {
          const active = frame >= startFrame;
          const justLanded = frame >= startFrame && frame < startFrame + 6;
          return (
            // The space between spans is load-bearing: adjacent inline-blocks
            // with no whitespace give the line no break opportunity, so a long
            // caption would run off the frame instead of wrapping.
            <Fragment key={i}>
              <span
                style={{
                  color: active
                    ? emphasis.has(i)
                      ? emphasisColor
                      : highlight
                    : "rgba(255,255,255,0.55)",
                  transform: justLanded ? "scale(1.08)" : "scale(1)",
                  display: "inline-block",
                  transition: "none",
                }}
              >
                {word}
              </span>{" "}
            </Fragment>
          );
        })}
      </>
    );
  }

  // Static caption with one or more words popped in the accent color — the
  // "…changed EVERYTHING" move. Only pays the per-word span cost when asked for.
  if (animation === "none" && emphasis.size > 0) {
    return (
      <>
        {segment.caption
          .trim()
          .split(/\s+/)
          .map((word, i) => (
            <Fragment key={i}>
              <span style={emphasis.has(i) ? { color: emphasisColor } : undefined}>
                {word}
              </span>{" "}
            </Fragment>
          ))}
      </>
    );
  }

  if (animation === "typewriter") {
    const chars = segment.caption.length;
    const shown = Math.round(
      interpolate(frame, [0, Math.max(1, durationInFrames * 0.7)], [0, chars], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    );
    return <>{segment.caption.slice(0, shown)}</>;
  }

  return <>{segment.caption}</>;
};

const Caption = ({
  segment,
  durationInFrames,
}: {
  segment: Segment;
  durationInFrames: number;
}) => {
  const frame = useCurrentFrame(); // relative to the enclosing Sequence
  const { height } = useVideoConfig();

  let opacity = 1;
  let translateX = 0;
  if (segment.transitionIn === "fade") {
    opacity = interpolate(frame, [0, TRANSITION_FRAMES], [0, 1], {
      extrapolateRight: "clamp",
    });
  } else if (segment.transitionIn === "slide") {
    opacity = interpolate(frame, [0, TRANSITION_FRAMES], [0, 1], {
      extrapolateRight: "clamp",
    });
    translateX = interpolate(frame, [0, TRANSITION_FRAMES], [120, 0], {
      extrapolateRight: "clamp",
    });
  }

  const isTip = segment.captionStyle === "tip";
  const image = segment.image;
  const color = segment.captionColor;
  const size = segment.captionSize;
  const font = segment.captionFont;
  const weight = segment.captionWeight;
  const outline = segment.captionOutline;
  const background = segment.captionBackground;

  const captionEl = (
    <div
      style={{
        color: "white",
        fontFamily: "Helvetica, Arial, sans-serif",
        maxWidth: "90%",
        whiteSpace: "pre-line",
        ...captionLooks[segment.captionStyle],
        ...(color ? { color } : {}),
        ...(size ? { fontSize: size } : {}),
        ...(font ? { fontFamily: font } : {}),
        ...(weight ? { fontWeight: weight } : {}),
        // paintOrder keeps the stroke behind the glyph, so a thick outline
        // thickens the letter instead of eating into it.
        ...(outline
          ? {
              WebkitTextStroke: `${outline.widthPx}px ${outline.color}`,
              paintOrder: "stroke fill",
            }
          : {}),
        ...(background
          ? { background, borderRadius: 24, padding: "24px 36px" }
          : {}),
      }}
    >
      <CaptionText segment={segment} durationInFrames={durationInFrames} />
    </div>
  );

  // Screenshot-style segment: floating card in the upper-middle band with the
  // caption directly under it (the classic "resources over b-roll" reel look).
  if (image) {
    return (
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 24 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 36,
            maxWidth: "96%",
            opacity,
            transform: `translateX(${translateX}px)`,
          }}
        >
          <Img
            src={staticFile(image)}
            style={{
              maxWidth: "100%",
              borderRadius: 8,
              boxShadow: "0 16px 56px rgba(0,0,0,0.55)",
            }}
          />
          {captionEl}
        </div>
      </AbsoluteFill>
    );
  }

  const position = segment.captionPosition ?? (isTip ? "bottom" : "center");
  // Insets are a FRACTION of frame height, not fixed pixels: the same 220px
  // was a fifth of a 960-tall frame and a ninth of a 1920-tall one, so the
  // "safe" default drifted with the output size. The defaults clear the
  // platform chrome — see src/safe-area.ts in mimic-mcp for the regions.
  const inset =
    segment.captionInset ?? (position === "top" ? TOP_INSET : BOTTOM_INSET);
  return (
    <AbsoluteFill
      style={{
        justifyContent:
          position === "top" ? "flex-start" : position === "bottom" ? "flex-end" : "center",
        alignItems: "center",
        padding: 64,
        paddingTop: position === "top" ? height * inset : 64,
        paddingBottom: position === "bottom" ? height * inset : 64,
      }}
    >
      {/* full-width wrapper: captionEl's maxWidth must resolve against the
          frame, not against the text's own fit-content box */}
      <div
        style={{
          opacity,
          transform: `translateX(${translateX}px)`,
          width: "100%",
          display: "flex",
          justifyContent: "center",
        }}
      >
        {captionEl}
      </div>
    </AbsoluteFill>
  );
};

const backgroundStyle = (fit: string, position?: string): CSSProperties => ({
  width: "100%",
  height: "100%",
  objectFit: fit as CSSProperties["objectFit"],
  ...(position ? { objectPosition: position } : {}),
});

// Where a keyframed crop sits at `atSeconds` (segment-relative), holding the
// ends rather than extrapolating past them. Mirrors positionAt in the server's
// subject-track.ts, which is where the curve is unit-tested.
const trackPositionAt = (
  track: { atSeconds: number; x: number; y: number }[],
  atSeconds: number
): string => {
  const first = track[0];
  const last = track[track.length - 1];
  if (atSeconds <= first.atSeconds) return positionString(first.x, first.y);
  if (atSeconds >= last.atSeconds) return positionString(last.x, last.y);

  for (let i = 1; i < track.length; i++) {
    const b = track[i];
    if (atSeconds > b.atSeconds) continue;
    const a = track[i - 1];
    const span = b.atSeconds - a.atSeconds;
    const t = span <= 0 ? 0 : (atSeconds - a.atSeconds) / span;
    return positionString(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }
  return positionString(last.x, last.y);
};

const positionString = (x: number, y: number): string =>
  `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`;

const easings: Record<string, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
};

// How the incoming segment's background enters over its first `frames` frames.
// The previous segment's background keeps rendering underneath (its Sequence is
// extended by the same amount), so dissolves/wipes/slides have footage to blend
// against. Dips don't need underlap — they ride a solid-color overlay instead.
const transitionWrap = (
  transition: VideoTransition | undefined,
  frame: number,
  frames: number,
  width: number,
  height: number
): CSSProperties => {
  if (!transition || frames <= 0 || frame >= frames) return {};
  const t = Math.min(1, Math.max(0, frame / frames));
  if (transition.kind === "dissolve") {
    return { opacity: t };
  }
  if (transition.kind === "wipe") {
    const dir = transition.direction ?? "right";
    const remaining = (1 - t) * 100;
    const inset =
      dir === "right"
        ? `inset(0 ${remaining}% 0 0)`
        : dir === "left"
          ? `inset(0 0 0 ${remaining}%)`
          : dir === "down"
            ? `inset(0 0 ${remaining}% 0)`
            : `inset(${remaining}% 0 0 0)`;
    return { clipPath: inset };
  }
  if (transition.kind === "slide") {
    const dir = transition.direction ?? "right";
    const off = 1 - t;
    const x = dir === "right" ? -off * width : dir === "left" ? off * width : 0;
    const y = dir === "down" ? -off * height : dir === "up" ? off * height : 0;
    return { transform: `translate(${x}px, ${y}px)` };
  }
  return {};
};

// One segment's background layer — footage, a still image, or a designed CSS
// fill — optionally punched-in with an animated zoom. The scale ramps from
// zoom.from to zoom.to across the segment, anchored at the focal point so the
// interesting region stays framed — the screen-recording move. Stills and
// fills ride the same zoom/transition machinery as footage, which is what lets
// from-scratch reels (no video at all) reuse every move footage reels have.
const SegmentBackground = ({
  video,
  image,
  fill,
  sceneEl,
  fit,
  muted,
  startFrom,
  position,
  track,
  zoom,
  speed,
  durationInFrames,
  transition,
  transitionFrames,
}: {
  video?: string;
  image?: string;
  fill?: string;
  sceneEl?: ReactNode;
  fit: string;
  muted: boolean;
  startFrom: number;
  position?: string;
  track?: { atSeconds: number; x: number; y: number }[];
  zoom?: Zoom;
  speed?: number;
  durationInFrames: number;
  transition?: VideoTransition;
  transitionFrames: number;
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  // A track follows a moving subject, so it wins over the single fixed point.
  const framePosition =
    track && track.length > 0 ? trackPositionAt(track, frame / fps) : position;
  const media = sceneEl ? (
    <AbsoluteFill>{sceneEl}</AbsoluteFill>
  ) : video ? (
    <OffthreadVideo
      src={staticFile(video)}
      muted={muted}
      startFrom={startFrom}
      playbackRate={speed ?? 1}
      style={backgroundStyle(fit, framePosition)}
    />
  ) : image ? (
    <Img src={staticFile(image)} style={backgroundStyle(fit, framePosition)} />
  ) : (
    <AbsoluteFill style={{ background: fill ?? "black" }} />
  );

  let inner = media;
  if (zoom) {
    const progress = Math.min(1, Math.max(0, frame / durationInFrames));
    const eased = (easings[zoom.easing ?? "linear"] ?? easings.linear)(progress);
    const scale = zoom.from + (zoom.to - zoom.from) * eased;
    inner = (
      <AbsoluteFill
        style={{
          transform: `scale(${scale})`,
          transformOrigin: `${zoom.focusX * 100}% ${zoom.focusY * 100}%`,
        }}
      >
        {media}
      </AbsoluteFill>
    );
  }

  const wrap = transitionWrap(transition, frame, transitionFrames, width, height);
  if (Object.keys(wrap).length === 0) return inner;
  return <AbsoluteFill style={wrap}>{inner}</AbsoluteFill>;
};

// A persistent brand mark: a logo bug, a handle, or a progress bar. Positioned
// off the frame's own width so the same recipe brands a 1080x1920 reel and a
// 1080x1080 crop identically.
const BrandOverlay = ({
  overlay,
  durationInFrames,
}: {
  overlay: Overlay;
  durationInFrames: number;
}) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const inset = overlay.margin * width;

  if (overlay.kind === "progressBar") {
    const progress = Math.min(1, Math.max(0, frame / Math.max(1, durationInFrames)));
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            [overlay.edge]: 0,
            height: `${overlay.size * 100}%`,
            opacity: overlay.opacity,
          }}
        >
          <div
            style={{
              width: `${progress * 100}%`,
              height: "100%",
              backgroundColor: overlay.color,
            }}
          />
        </div>
      </AbsoluteFill>
    );
  }

  const [vertical, horizontal] = overlay.corner.split("-") as [
    "top" | "bottom",
    "left" | "right",
  ];

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          [vertical]: inset,
          [horizontal]: inset,
          opacity: overlay.opacity,
        }}
      >
        {overlay.kind === "image" && overlay.file ? (
          <Img src={staticFile(overlay.file)} style={{ width: overlay.size * width }} />
        ) : (
          <span
            style={{
              color: overlay.color,
              fontSize: overlay.size * width,
              fontWeight: 700,
              fontFamily: "system-ui, -apple-system, Helvetica, Arial, sans-serif",
              whiteSpace: "nowrap",
              // Readable over whatever the footage is doing underneath.
              textShadow: "0 2px 12px rgba(0,0,0,0.55)",
            }}
          >
            {overlay.text}
          </span>
        )}
      </div>
    </AbsoluteFill>
  );
};

// Solid-color flash carrying a dip-to-black/white: fades the color in up to
// the segment boundary and out again after it, covering footage and captions.
const DipOverlay = ({
  color,
  durationInFrames,
}: {
  color: string;
  durationInFrames: number;
}) => {
  const frame = useCurrentFrame();
  const half = durationInFrames / 2;
  const opacity = interpolate(frame, [0, half, durationInFrames], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ backgroundColor: color, opacity }} />;
};

// A dip needs footage to have transitioned by the time the flash peaks; the
// underlap/overlay math treats it separately from blend transitions.
const needsUnderlap = (t?: VideoTransition): boolean =>
  t != null && (t.kind === "dissolve" || t.kind === "wipe" || t.kind === "slide");

export const Reel = (recipe: Recipe) => {
  const { fps } = useVideoConfig();
  useGoogleFonts(recipe.googleFonts);

  const reelFrames = Math.round(recipe.output.durationSeconds * fps);
  const duck = duckWindow(recipe.voiceover, recipe.music, fps, reelFrames);

  // Any segment with its own background (slice, source, image, fill), a zoom,
  // or a video transition turns the reel into a montage: each segment renders
  // its own background layer instead of one continuous take.
  const isMontage = recipe.segments.some(
    (s) =>
      s.backgroundStart != null ||
      s.backgroundVideo != null ||
      s.backgroundImage != null ||
      s.backgroundFill != null ||
      s.scene != null ||
      s.backgroundPosition != null ||
      s.backgroundTrack != null ||
      s.zoom != null ||
      s.speed != null ||
      s.videoTransitionIn != null
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {!isMontage &&
        (recipe.background.video ? (
          <OffthreadVideo
            src={staticFile(recipe.background.video)}
            muted={recipe.background.muted}
            style={backgroundStyle(recipe.background.fit)}
          />
        ) : recipe.background.fill ? (
          <AbsoluteFill style={{ background: recipe.background.fill }} />
        ) : null)}

      {/* Music sits under the narration: its gain is a curve, not a constant,
          so it fades in/out and ducks while the voiceover speaks. */}
      {recipe.music ? (
        <Audio
          src={staticFile(recipe.music.file)}
          startFrom={Math.round(recipe.music.startSeconds * fps)}
          volume={(f) =>
            musicGain({
              frame: f,
              fps,
              durationInFrames: reelFrames,
              volume: recipe.music!.volume,
              fadeInSeconds: recipe.music!.fadeInSeconds,
              fadeOutSeconds: recipe.music!.fadeOutSeconds,
              duck: duck,
            })
          }
        />
      ) : null}

      {recipe.voiceover ? (
        <Sequence from={Math.round(recipe.voiceover.startSeconds * fps)}>
          <Audio src={staticFile(recipe.voiceover.file)} volume={recipe.voiceover.volume} />
        </Sequence>
      ) : null}

      {/* Background pass. A segment whose successor enters with a blend
          transition renders EXTENDED by the transition length, so the incoming
          footage has something to dissolve/wipe/slide over. */}
      {isMontage &&
        recipe.segments.map((segment, i) => {
          const bgStart = segment.backgroundStart;
          // Per-segment source wins over the global one; a segment-level scene,
          // image or fill means "no footage here", even when the reel has a video.
          const Scene = segment.scene ? scenes[segment.scene] : undefined;
          if (segment.scene && !Scene) {
            throw new Error(
              `segment ${i} asks for scene "${segment.scene}" but src/scenes/index.ts ` +
                "doesn't register it — re-run scaffold_reel or add it to the registry"
            );
          }
          const bgImage = segment.backgroundImage;
          const bgFill = segment.backgroundFill;
          const bgVideo =
            Scene || bgImage || bgFill
              ? undefined
              : (segment.backgroundVideo ?? recipe.background.video);
          const bgPosition = segment.backgroundPosition;
          const zoom = segment.zoom;
          const speed = segment.speed;
          const transition = segment.videoTransitionIn;
          const nextTransition = recipe.segments[i + 1]?.videoTransitionIn;
          const extendFrames = needsUnderlap(nextTransition)
            ? Math.round(nextTransition!.durationSeconds * fps)
            : 0;
          const durationInFrames = Math.round((segment.end - segment.start) * fps);
          return (
            <Sequence
              key={`bg-${i}`}
              from={Math.round(segment.start * fps)}
              durationInFrames={durationInFrames + extendFrames}
            >
              <SegmentBackground
                video={bgVideo}
                image={bgImage}
                fill={bgFill ?? recipe.background.fill}
                sceneEl={
                  Scene ? (
                    <Scene segment={segment} durationInFrames={durationInFrames} />
                  ) : undefined
                }
                fit={recipe.background.fit}
                muted={recipe.background.muted}
                startFrom={Math.round((bgStart ?? segment.start) * fps)}
                position={bgPosition}
                track={segment.backgroundTrack}
                zoom={zoom}
                speed={speed}
                durationInFrames={durationInFrames}
                transition={needsUnderlap(transition) ? transition : undefined}
                transitionFrames={
                  transition ? Math.round(transition.durationSeconds * fps) : 0
                }
              />
            </Sequence>
          );
        })}

      {/* Caption + sound pass, on exact segment bounds. */}
      {recipe.segments.map((segment, i) => {
        const sound = segment.sound;
        const soundVolume =
          segment.soundVolume ?? 0.7;
        const durationInFrames = Math.round((segment.end - segment.start) * fps);
        return (
          <Sequence
            key={`fg-${i}`}
            from={Math.round(segment.start * fps)}
            durationInFrames={durationInFrames}
          >
            {sound ? <Audio src={staticFile(sound)} volume={soundVolume} /> : null}
            <Caption segment={segment} durationInFrames={durationInFrames} />
          </Sequence>
        );
      })}

      {/* Dip flashes, centered on each dip segment's start. */}
      {recipe.segments.map((segment, i) => {
        const transition = segment.videoTransitionIn;
        if (!transition || !transition.kind.startsWith("dip-")) return null;
        const dipFrames = Math.max(2, Math.round(transition.durationSeconds * fps));
        const from = Math.max(0, Math.round(segment.start * fps) - Math.round(dipFrames / 2));
        return (
          <Sequence key={`dip-${i}`} from={from} durationInFrames={dipFrames}>
            <DipOverlay
              color={transition.kind === "dip-to-black" ? "black" : "white"}
              durationInFrames={dipFrames}
            />
          </Sequence>
        );
      })}

      {/* Brand layer: drawn last so a logo bug or handle sits above everything,
          including the dip flashes — a watermark that a transition can cover
          isn't a watermark. */}
      {(recipe.overlays ?? []).map((overlay, i) => {
        const from = Math.round((overlay.fromSeconds ?? 0) * fps);
        const to = Math.round(
          (overlay.toSeconds ?? recipe.output.durationSeconds) * fps
        );
        const frames = Math.max(1, to - from);
        return (
          <Sequence key={`overlay-${i}`} from={from} durationInFrames={frames}>
            <BrandOverlay overlay={overlay} durationInFrames={frames} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
