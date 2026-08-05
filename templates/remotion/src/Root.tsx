import { Composition } from "remotion";
import { Reel } from "./Reel";
import { recipeSchema, type Recipe } from "./recipeSchema";
import recipeJson from "../recipe.json";

// recipe.json is the source of truth for a render; the schema turns Remotion
// Studio's right-hand panel into an editor for every recipe field. Edits made
// in Studio apply to previews and Studio-triggered renders.
const recipe = recipeSchema.parse(recipeJson) as Recipe;

export const Root = () => (
  <Composition
    id="Reel"
    component={Reel}
    schema={recipeSchema}
    defaultProps={recipe}
    width={recipe.output.width}
    height={recipe.output.height}
    fps={recipe.output.fps}
    durationInFrames={Math.round(recipe.output.durationSeconds * recipe.output.fps)}
  />
);
