import React from "react";
import { Composition } from "remotion";
import { ShadowAnalyticsLaunch, TOTAL_DURATION } from "./Composition";
import { fonts } from "./design/fonts";

void fonts;

export const Root: React.FC = () => (
  <Composition
    id="Launch"
    component={ShadowAnalyticsLaunch}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={TOTAL_DURATION}
  />
);
