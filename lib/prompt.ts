// lib/prompt.ts
import type OpenAI from "openai";
import { writeOverwrite } from "./storage";

export async function generateDiagramPrompt(params: {
  openai: OpenAI;
  codeText: string;
  promptPath: string;
}) {
  const { openai, codeText, promptPath } = params;

  // =========================================================
  // #2. Code(.py) -> Prompt text (English)
  // - Add strict anti-cropping constraints (safe margins + fit-to-canvas)
  // - Force a widescreen/landscape slide look
  // =========================================================
  const system = `
You are a "research figure prompt writer".
Convert Python code into an English image-generation prompt for a clean PowerPoint-style academic pipeline diagram.
Return ONLY the final prompt text (no markdown, no explanations).
`;

  const user = `
Python code (input):
---
${codeText.slice(0, 12000)}
---

Write a detailed image-generation prompt that produces a clean academic pipeline diagram.

STRICT REQUIREMENTS (must include in your prompt):
- Canvas & Layout: Landscape / widescreen slide-like diagram. Left-to-right flow unless the code strongly implies otherwise.
- Safe Margin: Leave generous padding (8–12% margin) on all sides. Do NOT place any text/shapes near edges.
- No Cropping: Fit ALL elements fully inside the canvas. Nothing should be cut off.
- Style: PowerPoint-like clean infographic (flat vector style), high readability, modern minimal aesthetics, consistent spacing/alignment.
- Typography: Large readable title at top; clear section headers; concise labels; avoid tiny text.
- Visual Language: Distinguish data blocks vs processing blocks; use rounded rectangles, thin clean arrows, subtle shadows.
- Colors: Use 3–5 harmonious pastel-like stage colors (academic slide palette). Avoid busy backgrounds.
- Output: A single complete diagram with a title and clearly labeled stages.

Now produce the final prompt text.
`;

  const resp = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const promptText = (resp.output_text || "").trim();
  if (!promptText) throw new Error("Failed to generate prompt text.");

  // Save prompt.txt (overwrite)
  await writeOverwrite(promptPath, promptText);

  return promptText;
}