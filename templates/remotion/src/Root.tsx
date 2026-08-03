import { Composition } from "remotion";
import { Reel } from "./Reel";
import recipe from "../recipe.json";

export const Root = () => (
  <Composition
    id="Reel"
    component={Reel}
    width={recipe.output.width}
    height={recipe.output.height}
    fps={recipe.output.fps}
    durationInFrames={Math.round(recipe.output.durationSeconds * recipe.output.fps)}
  />
);
