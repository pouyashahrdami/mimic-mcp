import { loadFont as loadSora } from "@remotion/google-fonts/Sora";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

const { fontFamily: sora } = loadSora("normal", { weights: ["600", "700", "800"], subsets: ["latin"] });
const { fontFamily: inter } = loadInter("normal", { weights: ["400", "600", "700"], subsets: ["latin"] });
const { fontFamily: mono } = loadMono("normal", { weights: ["500", "600"], subsets: ["latin"] });

export const fonts = { sora, inter, mono };
