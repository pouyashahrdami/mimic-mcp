import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { palette, fontDisplay, fontBody } from "../design/palette";
import { KineticWords } from "../design/KineticWords";
import { Eyebrow } from "../design/Eyebrow";
import { GlassCard } from "../design/GlassCard";

const Dot: React.FC<{ color: string }> = ({ color }) => (
  <div
    style={{
      width: 14,
      height: 14,
      borderRadius: "50%",
      border: `2px solid ${color}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <div style={{ width: 5, height: 5, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
  </div>
);

export const ProductIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const subOpacity = interpolate(frame, [40, 60], [0, 1], { extrapolateRight: "clamp" });
  const subY = interpolate(frame, [40, 60], [16, 0], { extrapolateRight: "clamp" });

  const lineP = spring({ frame: frame - 88, fps, config: { damping: 200, mass: 0.7 } });
  const lineW = interpolate(lineP, [0, 1], [0, 1]);
  const pulseLoop = (frame - 108) % 70;
  const pulseX = interpolate(pulseLoop, [0, 70], [0, 1], { extrapolateLeft: "clamp" });
  const pulseVisible = frame > 108 ? 1 : 0;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
      }}
    >
      <Eyebrow text="Introducing" delay={0} />

      <KineticWords
        segments={[{ text: "Shadow Analytics " }, { text: "MCP", color: palette.gold }]}
        delay={10}
        stagger={4}
        fontSize={78}
        fontFamily={fontDisplay}
        fontWeight={800}
        defaultColor={palette.white}
      />

      <div
        style={{
          fontFamily: fontBody,
          fontSize: 26,
          color: palette.mist,
          opacity: subOpacity,
          transform: `translateY(${subY}px)`,
        }}
      >
        A Model Context Protocol server that plugs your call data into any AI.
      </div>

      <div style={{ display: "flex", alignItems: "center", marginTop: 26, position: "relative", width: 900 }}>
        <GlassCard delay={70} from="left" style={{ width: 320, height: 150 }} accent={palette.blue}>
          <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <Dot color={palette.blue} />
            <div style={{ fontFamily: fontDisplay, color: palette.white, fontSize: 24, fontWeight: 700 }}>Your Calls</div>
            <div style={{ fontFamily: fontBody, color: palette.mist, fontSize: 16 }}>Recordings, transcripts &amp; CDR</div>
          </div>
        </GlassCard>

        <div style={{ flex: 1, height: 3, position: "relative", margin: "0 4px" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              top: "50%",
              height: 2,
              transform: "translateY(-50%)",
              width: `${lineW * 100}%`,
              background: `linear-gradient(90deg, ${palette.blue}, ${palette.gold})`,
              boxShadow: `0 0 12px rgba(245,166,35,0.6)`,
            }}
          />
          {pulseVisible ? (
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: `${pulseX * 100}%`,
                width: 10,
                height: 10,
                marginTop: -5,
                marginLeft: -5,
                borderRadius: "50%",
                background: palette.goldBright,
                boxShadow: `0 0 16px ${palette.gold}`,
              }}
            />
          ) : null}
        </div>

        <GlassCard delay={90} from="right" style={{ width: 320, height: 150 }} accent={palette.gold}>
          <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <Dot color={palette.gold} />
            <div style={{ fontFamily: fontDisplay, color: palette.white, fontSize: 24, fontWeight: 700 }}>Shadow Analytics MCP</div>
            <div style={{ fontFamily: fontBody, color: palette.mist, fontSize: 16 }}>Secure, governed call analytics</div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
};
