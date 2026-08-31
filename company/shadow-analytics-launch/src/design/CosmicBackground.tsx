import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig, random, interpolate } from "remotion";
import { palette } from "./palette";

type Star = { x: number; y: number; r: number; depth: number; phase: number };

const STAR_COUNT = 140;

function useStars(): Star[] {
  return useMemo(() => {
    return new Array(STAR_COUNT).fill(0).map((_, i) => ({
      x: random(`star-x-${i}`) * 100,
      y: random(`star-y-${i}`) * 100,
      r: 0.6 + random(`star-r-${i}`) * 1.6,
      depth: 0.2 + random(`star-depth-${i}`) * 0.8,
      phase: random(`star-phase-${i}`) * Math.PI * 2,
    }));
  }, []);
}

export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.05 }) => {
  const frame = useCurrentFrame();
  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        mixBlendMode: "overlay",
        opacity,
      }}
    >
      <filter id="grain">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.9"
          numOctaves="2"
          seed={frame % 8}
          stitchTiles="stitch"
          result="noise"
        />
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.9 0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#grain)" />
    </svg>
  );
};

export const CosmicBackground: React.FC<{ totalDurationInFrames: number }> = ({
  totalDurationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const stars = useStars();

  const drift = interpolate(frame, [0, totalDurationInFrames], [0, -26], {
    extrapolateRight: "clamp",
  });
  const breathe = interpolate(frame, [0, totalDurationInFrames], [1, 1.045], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: palette.bg,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: -40,
          transform: `scale(${breathe}) translateY(${drift * 0.4}px)`,
          background: `
            radial-gradient(38% 44% at 8% 96%, rgba(255,138,61,0.22) 0%, rgba(255,138,61,0) 60%),
            radial-gradient(46% 52% at 96% 4%, rgba(62,166,255,0.20) 0%, rgba(62,166,255,0) 62%),
            radial-gradient(70% 60% at 50% 50%, rgba(6,10,20,0) 0%, ${palette.bg} 75%),
            linear-gradient(180deg, #060a14 0%, #04060c 55%, #05070e 100%)
          `,
        }}
      />

      <div style={{ position: "absolute", inset: 0, transform: `translateY(${drift}px)` }}>
        {stars.map((s, i) => {
          const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(frame / (14 + s.depth * 10) + s.phase));
          const px = (s.x / 100) * width;
          const py = ((s.y / 100) * height + drift * s.depth * 2) % height;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: px,
                top: py,
                width: s.r * 2,
                height: s.r * 2,
                borderRadius: "50%",
                background: "#ffffff",
                opacity: twinkle * (0.35 + s.depth * 0.5),
                boxShadow: s.r > 1.6 ? `0 0 ${s.r * 4}px rgba(255,255,255,0.5)` : undefined,
              }}
            />
          );
        })}
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(120% 90% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)`,
        }}
      />

      <Grain opacity={0.05} />
    </div>
  );
};
