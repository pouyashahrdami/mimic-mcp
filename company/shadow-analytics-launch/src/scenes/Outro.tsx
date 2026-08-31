import React from "react";
import { Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { palette, fontDisplay, fontBody, fontMono } from "../design/palette";
import { KineticWords } from "../design/KineticWords";

const Sparkle: React.FC<{ x: number; y: number; size: number; delay: number }> = ({ x, y, size, delay }) => {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const twinkle = 0.4 + 0.6 * Math.max(0, Math.sin(local / 10));
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        opacity: local > 0 ? twinkle : 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          width: 2,
          height: "100%",
          background: palette.goldBright,
          transform: "translateX(-50%)",
          boxShadow: `0 0 6px ${palette.goldBright}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          height: 2,
          width: "100%",
          background: palette.goldBright,
          transform: "translateY(-50%)",
          boxShadow: `0 0 6px ${palette.goldBright}`,
        }}
      />
    </div>
  );
};

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoP = spring({ frame: frame - 10, fps, config: { damping: 200, mass: 0.9 } });
  const logoScale = interpolate(logoP, [0, 1], [0.7, 1]);
  const logoOpacity = interpolate(logoP, [0, 1], [0, 1]);
  const glowPulse = 0.5 + 0.5 * Math.sin(frame / 22);

  const taglineOpacity = interpolate(frame, [50, 66], [0, 1], { extrapolateRight: "clamp" });

  const ctaP = spring({ frame: frame - 96, fps, config: { damping: 200, mass: 0.6 } });
  const ctaScale = interpolate(ctaP, [0, 1], [0.7, 1]);
  const ctaOpacity = interpolate(ctaP, [0, 1], [0, 1]);
  const shimmerX = ((frame - 96) % 90) / 90;

  const footerOpacity = interpolate(frame, [132, 150], [0, 1], { extrapolateRight: "clamp" });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 34,
      }}
    >
      <div style={{ position: "relative", width: 560, height: 220, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            position: "absolute",
            width: 420,
            height: 420,
            borderRadius: "50%",
            background: `radial-gradient(circle, rgba(245,166,35,${0.28 + glowPulse * 0.12}) 0%, rgba(245,166,35,0) 65%)`,
            opacity: logoOpacity,
          }}
        />
        <div
          style={{
            transform: `scale(${logoScale})`,
            opacity: logoOpacity,
            width: 460,
          }}
        >
          <Img src={staticFile("shadow-logo.png")} style={{ width: "100%", display: "block" }} />
        </div>
        <Sparkle x={330} y={30} size={16} delay={26} />
        <Sparkle x={350} y={55} size={10} delay={34} />
      </div>

      <div style={{ opacity: taglineOpacity }}>
        <KineticWords
          segments={[{ text: "Stop digging. " }, { text: "Start asking.", color: palette.gold }]}
          delay={50}
          stagger={3}
          fontSize={44}
          fontFamily={fontDisplay}
          fontWeight={700}
          defaultColor={palette.white}
        />
      </div>

      <div
        style={{
          position: "relative",
          opacity: ctaOpacity,
          transform: `scale(${ctaScale})`,
          overflow: "hidden",
          borderRadius: 40,
          background: `linear-gradient(90deg, ${palette.gold}, ${palette.goldBright})`,
          padding: "18px 40px",
          boxShadow: `0 10px 40px rgba(245,166,35,0.35)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: `${shimmerX * 160 - 30}%`,
            width: "30%",
            height: "100%",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)",
            transform: "skewX(-20deg)",
          }}
        />
        <span style={{ position: "relative", fontFamily: fontDisplay, fontWeight: 700, fontSize: 24, color: "#1a1200" }}>
          Add Shadow Analytics MCP to your AI ▶
        </span>
      </div>

      <div
        style={{
          opacity: footerOpacity,
          fontFamily: fontMono,
          fontSize: 16,
          letterSpacing: 1.5,
          color: palette.mist,
        }}
      >
        www.rsicloud.com &nbsp;·&nbsp; Model Context Protocol ready
      </div>
    </div>
  );
};
