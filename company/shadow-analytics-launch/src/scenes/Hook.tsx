import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { palette, fontMono, fontDisplay } from "../design/palette";
import { KineticWords } from "../design/KineticWords";

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const labelIn = spring({ frame, fps, config: { damping: 200 } });
  const labelOpacity = interpolate(frame, [0, 18, 46, 58], [0, 1, 1, 0]);
  const labelScale = interpolate(labelIn, [0, 1], [0.92, 1]);

  const statementOpacity = interpolate(frame, [50, 66], [0, 1], { extrapolateRight: "clamp" });
  const statementY = interpolate(frame, [50, 78], [26, 0], { extrapolateRight: "clamp" });

  const underlineP = spring({ frame: frame - 118, fps, config: { damping: 200, mass: 0.6 } });
  const underlineW = interpolate(underlineP, [0, 1], [0, 560]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ position: "absolute", opacity: labelOpacity, transform: `scale(${labelScale})` }}>
        <span
          style={{
            fontFamily: fontMono,
            color: palette.gold,
            fontSize: 30,
            letterSpacing: 7,
            fontWeight: 500,
            textTransform: "uppercase",
          }}
        >
          The real cost of call analytics
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
          opacity: statementOpacity,
          transform: `translateY(${statementY}px)`,
        }}
      >
        <KineticWords
          segments={[{ text: "It isn't the reports you run." }]}
          delay={50}
          stagger={3}
          fontSize={58}
          fontFamily={fontDisplay}
          fontWeight={700}
          defaultColor={palette.ice}
        />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <KineticWords
            segments={[
              { text: "It's the questions you " },
              { text: "stopped asking.", color: palette.gold },
            ]}
            delay={72}
            stagger={3}
            fontSize={58}
            fontFamily={fontDisplay}
            fontWeight={800}
            defaultColor={palette.ice}
          />
          <div
            style={{
              width: underlineW,
              height: 3,
              marginTop: 10,
              background: `linear-gradient(90deg, transparent, ${palette.gold}, transparent)`,
              boxShadow: `0 0 16px ${palette.gold}`,
            }}
          />
        </div>
      </div>
    </div>
  );
};
