// lib/pipeline.ts
import type OpenAI from "openai";
import { getArtifactPaths } from "./storage";
import { generateDiagramPrompt } from "./prompt";
import { generatePngFromPrompt } from "./image";
import { vectorizePngToSvg } from "./vectorizer";

export async function runPipeline(params: {
  openai: OpenAI;
  codeText: string;
  vectorizeMode: "cutouts" | "stacked";
  directive?: string; // ✅ NEW
}) {
  const { openai, codeText, vectorizeMode, directive } = params;

  const paths = await getArtifactPaths();

  // =========================================================
  // #2. Input(.py code) -> prompt.txt (overwrite)
  // =========================================================
  const promptText = await generateDiagramPrompt({
    openai,
    codeText,
    promptPath: paths.promptTxt,
    directive: directive || "", // ✅ pass
  });

  // =========================================================
  // #3. prompt.txt -> image.png (overwrite)
  // =========================================================
  const { pngBase64, pngBuffer } = await generatePngFromPrompt({
    openai,
    promptText,
    pngPath: paths.imagePng,
  });

  // =========================================================
  // #4. image.png -> image.svg via Vectorizer.AI (overwrite)
  // =========================================================
  const svgText = await vectorizePngToSvg({
    pngBuffer,
    svgPath: paths.imageSvg,
    shapeStacking: vectorizeMode,
  });

  return { promptText, pngBase64, svgText };
}