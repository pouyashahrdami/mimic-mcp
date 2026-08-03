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
import recipe from "../recipe.json";

type Segment = (typeof recipe.segments)[number];

const TRANSITION_FRAMES = 12;

// The three caption looks the recipe can ask for. Tweak freely — this file
// belongs to your project after scaffolding, not to reels-maker.
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

const Caption = ({ segment }: { segment: Segment }) => {
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
  const image = "image" in segment ? segment.image : undefined;
  const color = "captionColor" in segment ? segment.captionColor : undefined;
  const size = "captionSize" in segment ? segment.captionSize : undefined;

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
      }}
    >
      {segment.caption}
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

  return (
    <AbsoluteFill
      style={{
        justifyContent: isTip ? "flex-end" : "center",
        alignItems: "center",
        padding: 64,
        paddingBottom: isTip ? 220 : 64,
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

const backgroundStyle = (fit: string): CSSProperties => ({
  width: "100%",
  height: "100%",
  objectFit: fit as CSSProperties["objectFit"],
});

export const Reel = () => {
  const { fps } = useVideoConfig();

  // Any segment with backgroundStart turns the reel into a montage: each
  // segment shows its own slice of the footage instead of one continuous take.
  const isMontage = recipe.segments.some(
    (s) => "backgroundStart" in s && s.backgroundStart != null
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

      {recipe.segments.map((segment, i) => {
        const bgStart =
          "backgroundStart" in segment ? segment.backgroundStart : undefined;
        return (
          <Sequence
            key={i}
            from={Math.round(segment.start * fps)}
            durationInFrames={Math.round((segment.end - segment.start) * fps)}
          >
            {isMontage && (
              <OffthreadVideo
                src={staticFile(recipe.background.video)}
                muted={recipe.background.muted}
                startFrom={Math.round((bgStart ?? segment.start) * fps)}
                style={backgroundStyle(recipe.background.fit)}
              />
            )}
            <Caption segment={segment} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
