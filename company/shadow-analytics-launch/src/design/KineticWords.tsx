import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

type Segment = { text: string; color?: string };

type Props = {
  segments: Segment[];
  delay?: number;
  fontSize: number;
  fontFamily: string;
  fontWeight?: number | string;
  letterSpacing?: number;
  lineHeight?: number;
  stagger?: number;
  align?: "left" | "center";
  defaultColor?: string;
};

export const KineticWords: React.FC<Props> = ({
  segments,
  delay = 0,
  fontSize,
  fontFamily,
  fontWeight = 700,
  letterSpacing = 0,
  lineHeight = 1.1,
  stagger = 3,
  align = "center",
  defaultColor = "#fff",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const words: { text: string; color: string; index: number }[] = [];
  segments.forEach((seg) => {
    seg.text.split(" ").forEach((w) => {
      if (w.length === 0) return;
      words.push({ text: w, color: seg.color ?? defaultColor, index: words.length });
    });
  });

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: align === "center" ? "center" : "flex-start",
        fontFamily,
        fontWeight,
        fontSize,
        letterSpacing,
        lineHeight,
      }}
    >
      {words.map((w) => {
        const local = frame - delay - w.index * stagger;
        const p = spring({ frame: local, fps, config: { damping: 200, mass: 0.6, stiffness: 160 } });
        const opacity = interpolate(p, [0, 1], [0, 1]);
        const translateY = interpolate(p, [0, 1], [26, 0]);
        const blur = interpolate(p, [0, 1], [10, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const scale = interpolate(p, [0, 1], [0.92, 1]);
        return (
          <span
            key={w.index}
            style={{
              display: "inline-block",
              marginRight: fontSize * 0.22,
              color: w.color,
              opacity,
              transform: `translateY(${translateY}px) scale(${scale})`,
              filter: `blur(${blur}px)`,
              whiteSpace: "pre",
            }}
          >
            {w.text}
          </span>
        );
      })}
    </div>
  );
};
