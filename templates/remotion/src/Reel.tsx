import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Recipe, Segment, VideoTransition, Zoom } from "./recipeSchema";

const TRANSITION_FRAMES = 12;
const DEFAULT_HIGHLIGHT = "#ffe000";

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
            <span
              key={i}
              style={{
                color: active ? highlight : "rgba(255,255,255,0.55)",
                transform: justLanded ? "scale(1.08)" : "scale(1)",
                display: "inline-block",
                transition: "none",
                marginRight: "0.28em",
              }}
            >
              {word}
            </span>
          );
        })}
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
  return (
    <AbsoluteFill
      style={{
        justifyContent:
          position === "top" ? "flex-start" : position === "bottom" ? "flex-end" : "center",
        alignItems: "center",
        padding: 64,
        paddingTop: position === "top" ? 220 : 64,
        paddingBottom: position === "bottom" ? 220 : 64,
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

// One segment's background clip, optionally punched-in with an animated zoom.
// The scale ramps from zoom.from to zoom.to across the segment, anchored at the
// focal point so the interesting region stays framed — the screen-recording move.
const SegmentBackground = ({
  src,
  fit,
  muted,
  startFrom,
  position,
  zoom,
  speed,
  durationInFrames,
  transition,
  transitionFrames,
}: {
  src: string;
  fit: string;
  muted: boolean;
  startFrom: number;
  position?: string;
  zoom?: Zoom;
  speed?: number;
  durationInFrames: number;
  transition?: VideoTransition;
  transitionFrames: number;
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const video = (
    <OffthreadVideo
      src={staticFile(src)}
      muted={muted}
      startFrom={startFrom}
      playbackRate={speed ?? 1}
      style={backgroundStyle(fit, position)}
    />
  );

  let inner = video;
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
        {video}
      </AbsoluteFill>
    );
  }

  const wrap = transitionWrap(transition, frame, transitionFrames, width, height);
  if (Object.keys(wrap).length === 0) return inner;
  return <AbsoluteFill style={wrap}>{inner}</AbsoluteFill>;
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

  // Any segment with backgroundStart, its own backgroundVideo, or a zoom turns
  // the reel into a montage: each segment shows its own slice/source (and can be
  // independently zoomed) instead of one continuous take.
  const isMontage = recipe.segments.some(
    (s) =>
      s.backgroundStart != null ||
      s.backgroundVideo != null ||
      s.backgroundPosition != null ||
      s.zoom != null ||
      s.speed != null ||
      s.videoTransitionIn != null
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {!isMontage && (
        <OffthreadVideo
          src={staticFile(recipe.background.video)}
          muted={recipe.background.muted}
          style={backgroundStyle(recipe.background.fit)}
        />
      )}

      {recipe.music ? (
        <Audio src={staticFile(recipe.music.file)} volume={recipe.music.volume} />
      ) : null}

      {/* Background pass. A segment whose successor enters with a blend
          transition renders EXTENDED by the transition length, so the incoming
          footage has something to dissolve/wipe/slide over. */}
      {isMontage &&
        recipe.segments.map((segment, i) => {
          const bgStart = segment.backgroundStart;
          const bgVideo = segment.backgroundVideo;
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
                src={bgVideo ?? recipe.background.video}
                fit={recipe.background.fit}
                muted={recipe.background.muted}
                startFrom={Math.round((bgStart ?? segment.start) * fps)}
                position={bgPosition}
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
    </AbsoluteFill>
  );
};
