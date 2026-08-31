import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { palette, fontDisplay, fontBody, fontMono } from "../design/palette";

const TypedLine: React.FC<{ text: string; start: number; framesTotal: number; fontSize?: number; color?: string }> = ({
  text,
  start,
  framesTotal,
  fontSize = 24,
  color = palette.white,
}) => {
  const frame = useCurrentFrame();
  const local = frame - start;
  const chars = Math.max(0, Math.min(text.length, Math.floor((local / framesTotal) * text.length)));
  const done = chars >= text.length;
  const blink = Math.sin(frame / 4) > 0;
  return (
    <span style={{ fontFamily: fontBody, fontSize, color }}>
      {text.slice(0, chars)}
      {!done && local > 0 ? <span style={{ opacity: blink ? 1 : 0, color: palette.gold }}>▌</span> : null}
    </span>
  );
};

const StreamWords: React.FC<{ lines: string[]; start: number; wordsPerFrame: number; fontSize?: number; color?: string }> = ({
  lines,
  start,
  wordsPerFrame,
  fontSize = 24,
  color = palette.mist,
}) => {
  const frame = useCurrentFrame();
  const local = Math.max(0, frame - start);
  const visible = Math.floor(local * wordsPerFrame);
  let counter = 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {lines.map((line, li) => {
        const words = line.split(" ");
        const shown = words
          .map((w) => {
            counter += 1;
            return counter <= visible ? w : null;
          })
          .filter(Boolean)
          .join(" ");
        if (shown.length === 0) return null;
        return (
          <div key={li} style={{ fontFamily: fontBody, fontSize, color, lineHeight: 1.5 }}>
            {shown}
          </div>
        );
      })}
    </div>
  );
};

const Bubble: React.FC<{ side: "you" | "ai"; delay: number; children: React.ReactNode }> = ({ side, delay, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 200, mass: 0.6 } });
  const opacity = interpolate(p, [0, 1], [0, 1]);
  const y = interpolate(p, [0, 1], [16, 0]);
  const isYou = side === "you";
  return (
    <div style={{ display: "flex", gap: 14, opacity, transform: `translateY(${y}px)` }}>
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          border: `1.5px solid ${isYou ? palette.gold : palette.blue}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: fontMono,
          fontSize: 11,
          letterSpacing: 1,
          color: isYou ? palette.gold : palette.blue,
          flexShrink: 0,
          background: "rgba(255,255,255,0.03)",
        }}
      >
        {isYou ? "YOU" : "AI"}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
};

const Bar: React.FC<{ label: string; pct: number; color: string; delay: number }> = ({ label, pct, color, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 200, mass: 0.7 } });
  const width = interpolate(p, [0, 1], [0, pct]);
  const shown = Math.round(interpolate(p, [0, 1], [0, pct]));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <div style={{ width: 190, fontFamily: fontBody, fontSize: 18, color: palette.ice }}>{label}</div>
      <div style={{ flex: 1, height: 10, borderRadius: 6, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${width}%`,
            background: `linear-gradient(90deg, ${color}, ${palette.goldBright})`,
            boxShadow: `0 0 12px ${color}`,
          }}
        />
      </div>
      <div style={{ width: 54, fontFamily: fontDisplay, fontSize: 18, fontWeight: 700, color: palette.white, textAlign: "right" }}>
        {shown}%
      </div>
    </div>
  );
};

export const ChatDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const winP = spring({ frame, fps, config: { damping: 200, mass: 0.8 } });
  const winOpacity = interpolate(winP, [0, 1], [0, 1]);
  const winScale = interpolate(winP, [0, 1], [0.96, 1]);

  const dotsOpacity = interpolate(frame, [60, 68, 96, 104], [0, 1, 1, 0]);

  const statP = spring({ frame: frame - 150, fps, config: { damping: 200, mass: 0.8 } });
  const statOpacity = interpolate(statP, [0, 1], [0, 1]);
  const statY = interpolate(statP, [0, 1], [26, 0]);

  const countP = interpolate(frame, [165, 205], [0, 48.2], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pillP = spring({ frame: frame - 195, fps, config: { damping: 200, mass: 0.6 } });
  const pillScale = interpolate(pillP, [0, 1], [0.6, 1]);
  const pillOpacity = interpolate(pillP, [0, 1], [0, 1]);

  const q2Opacity = interpolate(frame, [258, 268], [0, 1], { extrapolateRight: "clamp" });
  const q2Y = interpolate(frame, [258, 278], [16, 0], { extrapolateRight: "clamp" });

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          width: 1180,
          minHeight: 760,
          opacity: winOpacity,
          transform: `scale(${winScale})`,
          background: "rgba(10,14,24,0.55)",
          border: `1px solid ${palette.glassBorder}`,
          borderRadius: 24,
          backdropFilter: "blur(22px)",
          WebkitBackdropFilter: "blur(22px)",
          boxShadow: "0 40px 120px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
          padding: 40,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 26,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ width: 13, height: 13, borderRadius: "50%", background: "#ff5f57" }} />
            <div style={{ width: 13, height: 13, borderRadius: "50%", background: "#febc2e" }} />
            <div style={{ width: 13, height: 13, borderRadius: "50%", background: "#28c840" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: fontMono, fontSize: 15, color: palette.mist, letterSpacing: 0.5 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#28c840",
                boxShadow: "0 0 8px #28c840",
                opacity: 0.6 + 0.4 * Math.sin(frame / 6),
              }}
            />
            Connected · Shadow Analytics MCP
          </div>
        </div>

        <Bubble side="you" delay={16}>
          <div
            style={{
              display: "inline-block",
              padding: "14px 20px",
              borderRadius: 14,
              background: "rgba(255,255,255,0.05)",
              border: `1px solid ${palette.glassBorder}`,
            }}
          >
            <TypedLine text="What are customers calling about this week?" start={18} framesTotal={38} />
          </div>
        </Bubble>

        <Bubble side="ai" delay={58}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 6, opacity: dotsOpacity }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: palette.blue,
                    transform: `translateY(${Math.sin(frame / 3 + i * 1.4) * 4}px)`,
                  }}
                />
              ))}
            </div>

            <StreamWords
              lines={["You handled 48,200 calls this week, up 12% week-over-week.", "Three topics drove most of the volume."]}
              start={96}
              wordsPerFrame={0.42}
              fontSize={25}
              color={palette.ice}
            />

            <div
              style={{
                opacity: statOpacity,
                transform: `translateY(${statY}px)`,
                display: "flex",
                alignItems: "center",
                gap: 46,
                background: "rgba(255,255,255,0.035)",
                border: `1px solid ${palette.glassBorder}`,
                borderRadius: 18,
                padding: "26px 34px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 190 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                  <div style={{ fontFamily: fontDisplay, fontSize: 52, fontWeight: 800, color: palette.white }}>
                    {countP.toFixed(1)}K
                  </div>
                  <div
                    style={{
                      opacity: pillOpacity,
                      transform: `scale(${pillScale})`,
                      background: "rgba(40,200,64,0.12)",
                      border: "1px solid rgba(40,200,64,0.4)",
                      color: "#5fe085",
                      borderRadius: 20,
                      padding: "4px 12px",
                      fontFamily: fontBody,
                      fontSize: 15,
                      fontWeight: 600,
                    }}
                  >
                    ▲ 12% WoW
                  </div>
                </div>
                <div style={{ fontFamily: fontBody, fontSize: 15, color: palette.mist }}>Calls this week, by topic</div>
              </div>

              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
                <Bar label="Billing questions" pct={38} color={palette.gold} delay={205} />
                <Bar label="Password resets" pct={24} color={palette.amber} delay={218} />
                <Bar label="Shipping delays" pct={16} color={palette.blue} delay={231} />
              </div>
            </div>
          </div>
        </Bubble>

        <div style={{ opacity: q2Opacity, transform: `translateY(${q2Y}px)` }}>
          <Bubble side="you" delay={258}>
            <div
              style={{
                display: "inline-block",
                padding: "14px 20px",
                borderRadius: 14,
                background: "rgba(255,255,255,0.05)",
                border: `1px solid ${palette.glassBorder}`,
              }}
            >
              <TypedLine text="Why did billing calls jump?" start={262} framesTotal={26} />
            </div>
          </Bubble>
        </div>
      </div>
    </div>
  );
};
