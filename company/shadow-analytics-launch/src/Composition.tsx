import React from "react";
import { Audio, Sequence, staticFile } from "remotion";
import { CosmicBackground } from "./design/CosmicBackground";
import { Hook } from "./scenes/Hook";
import { ProductIntro } from "./scenes/ProductIntro";
import { ChatDemo } from "./scenes/ChatDemo";
import { FeatureGrid } from "./scenes/FeatureGrid";
import { HowItWorks } from "./scenes/HowItWorks";
import { Outro } from "./scenes/Outro";

const BOUNDS = {
  hook: 0,
  productIntro: 180,
  chatDemo: 360,
  featureGrid: 720,
  howItWorks: 930,
  outro: 1110,
  end: 1350,
};

export const TOTAL_DURATION = BOUNDS.end;

export const ShadowAnalyticsLaunch: React.FC = () => {
  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>
      <CosmicBackground totalDurationInFrames={TOTAL_DURATION} />

      <Sequence from={BOUNDS.hook} durationInFrames={BOUNDS.productIntro - BOUNDS.hook} layout="none">
        <Hook />
      </Sequence>
      <Sequence from={BOUNDS.productIntro} durationInFrames={BOUNDS.chatDemo - BOUNDS.productIntro} layout="none">
        <ProductIntro />
      </Sequence>
      <Sequence from={BOUNDS.chatDemo} durationInFrames={BOUNDS.featureGrid - BOUNDS.chatDemo} layout="none">
        <ChatDemo />
      </Sequence>
      <Sequence from={BOUNDS.featureGrid} durationInFrames={BOUNDS.howItWorks - BOUNDS.featureGrid} layout="none">
        <FeatureGrid />
      </Sequence>
      <Sequence from={BOUNDS.howItWorks} durationInFrames={BOUNDS.outro - BOUNDS.howItWorks} layout="none">
        <HowItWorks />
      </Sequence>
      <Sequence from={BOUNDS.outro} durationInFrames={BOUNDS.end - BOUNDS.outro} layout="none">
        <Outro />
      </Sequence>

      <Sequence from={BOUNDS.chatDemo + 195} durationInFrames={20} layout="none">
        <Audio src={staticFile("pop.wav")} volume={0.5} />
      </Sequence>
      <Sequence from={BOUNDS.chatDemo + 205} durationInFrames={20} layout="none">
        <Audio src={staticFile("pop.wav")} volume={0.4} />
      </Sequence>
      <Sequence from={BOUNDS.outro + 96} durationInFrames={10} layout="none">
        <Audio src={staticFile("click.wav")} volume={0.6} />
      </Sequence>
    </div>
  );
};
