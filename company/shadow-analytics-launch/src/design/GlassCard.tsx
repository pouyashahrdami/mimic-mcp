import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { palette } from "./palette";

type Props = {
  delay?: number;
  accent?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  from?: "bottom" | "left" | "right";
};

export const GlassCard: React.FC<Props> = ({ delay = 0, accent, style, children, from = "bottom" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = Math.max(0, frame - delay);

  const p = spring({ frame: local, fps, config: { damping: 200, mass: 0.7, stiffness: 120 } });
  const opacity = interpolate(p, [0, 1], [0, 1]);

  const offset = interpolate(p, [0, 1], [1, 0]);
  const translate =
    from === "bottom"
      ? `translateY(${offset * 46}px)`
      : from === "left"
      ? `translateX(${-offset * 60}px)`
      : `translateX(${offset * 60}px)`;

  const rotateX = interpolate(p, [0, 1], [10, 0]);
  const scale = interpolate(p, [0, 1], [0.94, 1]);

  return (
    <div
      style={{
        perspective: 1200,
        opacity,
        ...style,
      }}
    >
      <div
        style={{
          transform: `${translate} rotateX(${rotateX}deg) scale(${scale})`,
          transformStyle: "preserve-3d",
          background: palette.glass,
          border: `1px solid ${palette.glassBorder}`,
          borderRadius: 20,
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          boxShadow: accent
            ? `0 20px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 1px rgba(255,255,255,0.02)`
            : `0 20px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)`,
          borderLeft: accent ? `2px solid ${accent}` : undefined,
          position: "relative",
          height: "100%",
          boxSizing: "border-box",
        }}
      >
        {children}
      </div>
    </div>
  );
};
