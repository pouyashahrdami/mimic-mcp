import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { palette, fontDisplay, fontBody, fontMono } from "../design/palette";
import { KineticWords } from "../design/KineticWords";
import { Eyebrow } from "../design/Eyebrow";

const STEPS = [
  { n: "01", title: "Connect", body: "Point Shadow Analytics at your communication ecosystem." },
  { n: "02", title: "Ask", body: "Question it in plain language from your own AI assistant." },
  { n: "03", title: "Act", body: "Get analysis and the reasoning, not rows to decode." },
];

const LINE_START = 78;
const LINE_END = 148;

export const HowItWorks: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const lineP = spring({ frame: frame - LINE_START, fps, config: { damping: 200, mass: 1 } });
  const lineW = interpolate(lineP, [0, 1], [0, 100], { extrapolateRight: "clamp" });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 30,
      }}
    >
      <Eyebrow text="How it works" delay={0} />
      <KineticWords
        segments={[{ text: "From question to decision in seconds." }]}
        delay={20}
        stagger={2}
        fontSize={46}
        fontFamily={fontDisplay}
        fontWeight={700}
        defaultColor={palette.white}
      />

      <div style={{ position: "relative", width: 1180, marginTop: 30 }}>
        <div
          style={{
            position: "absolute",
            top: -28,
            left: 40,
            right: 40,
            height: 2,
            background: "rgba(255,255,255,0.08)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: -28,
            left: 40,
            width: `calc((100% - 80px) * ${lineW / 100})`,
            height: 2,
            background: `linear-gradient(90deg, ${palette.blue}, ${palette.gold})`,
            boxShadow: `0 0 14px ${palette.gold}`,
          }}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 22 }}>
          {STEPS.map((s, i) => {
            const activeAt = LINE_START + ((LINE_END - LINE_START) / STEPS.length) * (i + 0.5);
            const glowP = spring({ frame: frame - activeAt, fps, config: { damping: 200 } });
            const glow = interpolate(glowP, [0, 1], [0, 1]);
            const cardP = spring({ frame: frame - (60 + i * 14), fps, config: { damping: 200, mass: 0.7 } });
            const opacity = interpolate(cardP, [0, 1], [0, 1]);
            const y = interpolate(cardP, [0, 1], [30, 0]);

            return (
              <div
                key={s.n}
                style={{
                  opacity,
                  transform: `translateY(${y}px)`,
                  background: palette.glass,
                  border: `1px solid rgba(255,255,255,${0.1 + glow * 0.25})`,
                  borderRadius: 20,
                  padding: "34px 30px",
                  boxShadow: `0 20px 60px rgba(0,0,0,0.4), 0 0 ${glow * 40}px rgba(245,166,35,${glow * 0.35})`,
                }}
              >
                <div style={{ fontFamily: fontMono, fontSize: 30, fontWeight: 600, color: palette.gold, marginBottom: 14 }}>
                  {s.n}
                </div>
                <div style={{ fontFamily: fontDisplay, fontSize: 26, fontWeight: 700, color: palette.white, marginBottom: 10 }}>
                  {s.title}
                </div>
                <div style={{ fontFamily: fontBody, fontSize: 16, color: palette.mist, lineHeight: 1.5 }}>{s.body}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
