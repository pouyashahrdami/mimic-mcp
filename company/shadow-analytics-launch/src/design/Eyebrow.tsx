import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { palette, fontMono } from "./palette";

export const Eyebrow: React.FC<{ text: string; delay?: number; align?: "left" | "center" }> = ({
  text,
  delay = 0,
  align = "center",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  const opacity = interpolate(p, [0, 1], [0, 1]);
  const dash = interpolate(p, [0, 1], [0, 22]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: align === "center" ? "center" : "flex-start",
        gap: 12,
        opacity,
      }}
    >
      <div style={{ width: dash, height: 2, background: palette.gold, boxShadow: `0 0 8px ${palette.gold}` }} />
      <span
        style={{
          fontFamily: fontMono,
          color: palette.gold,
          fontSize: 22,
          letterSpacing: 6,
          fontWeight: 500,
          textTransform: "uppercase",
        }}
      >
        {text}
      </span>
    </div>
  );
};
