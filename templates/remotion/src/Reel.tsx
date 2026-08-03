import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Audio,
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

  return (
    <AbsoluteFill
      style={{
        justifyContent: isTip ? "flex-end" : "center",
        alignItems: "center",
        padding: 64,
        paddingBottom: isTip ? 220 : 64,
      }}
    >
      <div
        style={{
          color: "white",
          fontFamily: "Helvetica, Arial, sans-serif",
          maxWidth: "90%",
          opacity,
          transform: `translateX(${translateX}px)`,
          ...captionLooks[segment.captionStyle],
        }}
      >
        {segment.caption}
      </div>
    </AbsoluteFill>
  );
};

export const Reel = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <OffthreadVideo
        src={staticFile(recipe.background.video)}
        muted={recipe.background.muted}
        style={{
          width: "100%",
          height: "100%",
          objectFit: recipe.background.fit as CSSProperties["objectFit"],
        }}
      />

      {recipe.music ? (
        <Audio src={staticFile(recipe.music.file)} volume={recipe.music.volume} />
      ) : null}

      {recipe.segments.map((segment, i) => (
        <Sequence
          key={i}
          from={Math.round(segment.start * fps)}
          durationInFrames={Math.round((segment.end - segment.start) * fps)}
        >
          <Caption segment={segment} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
