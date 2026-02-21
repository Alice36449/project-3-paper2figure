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
  // - Output should be a "diagram image prompt" for PPT-style figure
  // =========================================================
  const system = `
You are a "research figure prompt writer".
Goal: convert Python code into an English prompt that can generate a clean, PowerPoint-style academic pipeline diagram (infographic).
Return ONLY the final prompt text (no markdown, no extra commentary).
`;

  const user = `
Python code (input):
---
${codeText.slice(0, 12000)}
---

Write a detailed image-generation prompt that:
- Produces a clean academic pipeline diagram
- Has clear stages/boxes/arrows
- Uses a slide-friendly style (PowerPoint-like, high readability, modern, clean)
- Uses consistent typography, spacing, and color themes per stage
- Avoids photorealism; must be vector-like / flat infographic
- Includes a title at the top
- Uses English labels
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