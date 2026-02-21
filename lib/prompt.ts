// lib/prompt.ts
import type OpenAI from "openai";
import { writeOverwrite } from "./storage";

export async function generateDiagramPrompt(params: {
  openai: OpenAI;
  codeText: string;
  promptPath: string;
  directive?: string; // ✅ NEW
}) {
  const { openai, codeText, promptPath, directive } = params;

  // =========================================================
  // #2. Code(.py) -> Prompt text (English)
  // - Stronger layout + typography constraints
  // - Add optional user directive (1-line) to control focus
  // =========================================================
  const system = `
You are an expert "code-to-diagram prompt writer".
You turn code into a high-quality PowerPoint-style academic infographic prompt.
Return ONLY the final image-generation prompt text (no markdown, no commentary).
`;

  // Keep code window limited for reliability
  const codeWindow = codeText.slice(0, 14000);

  const user = `
INPUT: Python code
---
${codeWindow}
---

OPTIONAL USER DIRECTION (if provided, MUST follow it):
"${(directive || "").trim()}"
(If empty, ignore this section.)

TASK:
Write a single, detailed image-generation prompt to create a clean CNN/ML pipeline diagram based on the code.

HARD STYLE REQUIREMENTS:
- Landscape widescreen infographic (slide-like).
- Leave generous safe margins (8–12%) on all sides; never place text near the edges.
- Flat vector look (PowerPoint). Clean rounded rectangles, subtle shadows, thin consistent strokes.
- Minimal icons. Prefer simple shapes over detailed illustrations.
- Typography: big title at top, readable headers, short labels. Avoid tiny text.
- Spelling accuracy is critical: do NOT invent weird words, do NOT typo.
- Use consistent alignment and spacing (grid layout). No overlaps.

CONTENT REQUIREMENTS:
- Extract the pipeline stages from the code. Prefer a 4–6 stage left-to-right flow:
  1) Data Loading / Preprocessing
  2) Model Architecture (CNN blocks)
  3) Training Loop
  4) Evaluation
  5) Inference / Output
  (Include only stages that actually appear in the code.)
- Inside "Model Architecture", show blocks in order:
  Conv → ReLU → Pool → Conv → ReLU → Pool → Flatten → FC → Softmax (if present).
- Inside "Training Loop", show mini-steps:
  batch → forward → loss → update → (repeat epochs) → metrics.
- Include key hyperparameters if found (batch size, epochs, lr, num_classes). If missing, omit.
- Use short bullet-like lines inside boxes (3–6 lines max per stage).

OUTPUT:
- Provide the final image prompt text only.
- The final diagram must look like a polished academic slide figure.
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