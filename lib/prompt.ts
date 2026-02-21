// lib/prompt.ts
import type OpenAI from "openai";
import { writeOverwrite } from "./storage";

export async function generateDiagramPrompt(params: {
  openai: OpenAI;
  codeText: string;
  promptPath: string;
  directive?: string;
}) {
  const { openai, codeText, promptPath, directive } = params;

  // Limit code window for stability
  const codeWindow = codeText.slice(0, 14000);

  const system = `
You are a senior ML code analyst and professional diagram prompt designer.
Your job is to convert Python ML code into a clean academic diagram prompt.
Return ONLY the final image-generation prompt.
Do NOT include commentary.
`;

  const user = `
INPUT PYTHON CODE:
--------------------
${codeWindow}
--------------------

OPTIONAL USER DIRECTION:
"${directive || ""}"

PRIORITY RULE (CRITICAL):
If a user direction is provided,
you MUST prioritize it over completeness.
You are allowed to omit parts of the code.
Do NOT try to visualize every function or utility.
Focus only on what matches the user's intent.

DEFAULT BEHAVIOR (when no directive):
Focus primarily on the MODEL ARCHITECTURE.
Do NOT automatically include every training/evaluation detail.
Prefer a simplified architecture-centric diagram.

SIMPLIFICATION RULES:
- Show only major conceptual blocks.
- Maximum 6 stages.
- Maximum 5 lines of text per block.
- Keep labels short (1–4 words).
- Avoid long sentences.
- Avoid tiny text.
- Avoid decorative icons.
- Avoid gradients or colorful infographic style unless explicitly requested.

STYLE REQUIREMENTS:
- Clean academic style.
- Either:
   (A) Monochrome research-paper schematic (if architecture-focused), OR
   (B) Minimal flat slide layout (if pipeline-focused).
- Landscape layout.
- Generous whitespace margins.
- Thin consistent strokes.
- No clutter.
- Clear left-to-right or top-to-bottom flow.

ARCHITECTURE RULES (if CNN detected):
If convolutional layers exist:
Represent as:
Input → Conv → ReLU → Pool → (repeat blocks) → Flatten → FC → Softmax
Only include layers that actually exist.
Group repeated blocks compactly.

TRAINING RULE (include only if directive requests it):
Represent as:
Batch → Forward → Loss → Update → Epoch loop → Metrics

HYPERPARAMETERS:
Include only the most important ones (batch size, epochs, lr, num_classes).
Omit minor values.

OUTPUT REQUIREMENTS:
Produce ONE single detailed image-generation prompt.
It must describe:
- Title
- Layout
- Blocks
- Flow arrows
- Visual style
- Text constraints
Do NOT mention analysis steps.
Return prompt text only.
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

  await writeOverwrite(promptPath, promptText);

  return promptText;
}