// lib/image.ts
import type OpenAI from "openai";
import { writeOverwrite } from "./storage";

export async function generatePngFromPrompt(params: {
  openai: OpenAI;
  promptText: string;
  pngPath: string;
}) {
  const { openai, promptText, pngPath } = params;

  // =========================================================
  // #3. Prompt -> Image (PNG)
  // - PPT-like style strongly enforced by prompt
  // =========================================================
  const result = await openai.images.generate({
    model: "gpt-image-1",
    prompt: promptText,
    size: "1024x1024",
  });

  const image_base64 = result.data?.[0]?.b64_json;
  if (!image_base64) throw new Error("Image generation failed.");

  const imageBuffer = Buffer.from(image_base64, "base64");

  // Save image.png (overwrite)
  await writeOverwrite(pngPath, imageBuffer);

  return { pngBase64: image_base64, pngBuffer: imageBuffer };
}