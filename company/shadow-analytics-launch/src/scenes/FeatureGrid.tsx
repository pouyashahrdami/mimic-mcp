import React from "react";
import { useCurrentFrame } from "remotion";
import { palette, fontDisplay, fontBody } from "../design/palette";
import { KineticWords } from "../design/KineticWords";
import { Eyebrow } from "../design/Eyebrow";
import { GlassCard } from "../design/GlassCard";

const FEATURES = [
  { title: "Ask in plain language", body: "No filters, no query syntax, no BI ticket", color: palette.gold },
  { title: "Call journey, cradle to grave", body: "Every hop, hold and handoff on one timeline", color: palette.amber },
  { title: "Use the AI you already have", body: "Claude, ChatGPT, Gemini, Copilot, Perplexity", color: palette.blue },
  { title: "Governed and secure", body: "Your data, your rules, your platform", color: palette.gold },
];

export const FeatureGrid: React.FC = () => {
  const frame = useCurrentFrame();
  void frame;

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
      <Eyebrow text="Conversational analytics" delay={0} />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <KineticWords
          segments={[{ text: "Answers to your questions." }]}
          delay={20}
          stagger={3}
          fontSize={46}
          fontFamily={fontDisplay}
          fontWeight={700}
          defaultColor={palette.white}
        />
        <KineticWords
          segments={[{ text: "Not reports to interpret.", color: palette.gold }]}
          delay={40}
          stagger={3}
          fontSize={46}
          fontFamily={fontDisplay}
          fontWeight={800}
          defaultColor={palette.gold}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, marginTop: 20, width: 1180 }}>
        {FEATURES.map((f, i) => (
          <GlassCard key={f.title} delay={78 + i * 16} accent={f.color} style={{ height: 132 }}>
            <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 30px", gap: 8 }}>
              <div style={{ fontFamily: fontDisplay, fontSize: 24, fontWeight: 700, color: palette.white }}>{f.title}</div>
              <div style={{ fontFamily: fontBody, fontSize: 16, color: palette.mist }}>{f.body}</div>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
};
