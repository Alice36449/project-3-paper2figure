// lib/prompt.ts
import type OpenAI from "openai";
import { writeOverwrite } from "./storage";

export async function generateDiagramPrompt(params: {
  openai: OpenAI;
  codeText: string;
  promptPath: string;
  directive?: string; // optional 1-line user direction
}) {
  const { openai, codeText, promptPath, directive } = params;

  // =========================================================
  // #2. Input(.py code) -> prompt.txt (overwrite)
  // - Goal: Write a DETAILED image-generation prompt so the image model
  //         can draw an accurate, paper-style "Methodology Pipeline" figure.
  // - Strategy:
  //   (1) Force evidence-based extraction (no guessing).
  //   (2) Focus on end-to-end pipeline (inputs → processing → outputs),
  //       highlight key logic (loops, thresholds, filtering, postprocess).
  //   (3) Return ONLY the final image prompt (no analysis text).
  // =========================================================

  // Keep a bounded window for stability (avoid huge context)
  const codeWindow = codeText.slice(0, 18000);

  const system = `
You are a senior ML codebase analyst AND an academic paper figure prompt writer.

Your mission:
Given Python code, write a SINGLE, highly detailed image-generation prompt
that enables a generative image model to draw an accurate "Methodology / Pipeline" figure.

Hard rules:
- Evidence-based ONLY: infer structure ONLY from what the code shows.
- No guessing, no invented components.
- If something is unclear in code, label it as "Unspecified" or omit it.
- Output MUST be English.
- Output MUST be ONLY the final image-generation prompt (no commentary, no bullets about your analysis).
`;

  const user = `
PYTHON CODE (read carefully):
----------------------------
${codeWindow}
----------------------------

OPTIONAL USER DIRECTION (highest priority):
"${directive || ""}"

CRITICAL PRIORITY RULE:
If the user direction is provided, prioritize it over completeness.
You may omit parts of the code that do not support the user's intent.

YOUR OUTPUT (IMPORTANT):
Return ONE single image-generation prompt that produces a paper-quality methodology figure.
Do NOT include analysis. Do NOT include JSON/YAML. Do NOT include multiple options.

WHAT TO EXTRACT FROM CODE (EVIDENCE CHECKLIST):
(Use only what is present in the code.)
1) Entry / execution flow:
   - main(), if __name__ == "__main__", CLI, argparse, scripts
2) Data pipeline:
   - dataset class, dataloader, transforms, preprocessing, splits, batching
3) Model pipeline:
   - model creation, backbone/head, forward flow, key submodules
4) Training loop (ONLY if code contains it OR user direction requests it):
   - loss computation, optimizer step, scheduler step, epoch/iter loops
5) Inference + post-processing:
   - thresholds, filtering, NMS, top-k, mask refinement, decoding steps
6) Outputs / artifacts:
   - saved checkpoints, logs, metrics, output files, visualization saving
7) Key hyperparameters (ONLY if explicit in code):
   - batch_size, epochs, lr, image_size, num_classes, thresholds, etc.

FIGURE REQUIREMENTS (the prompt you write must enforce these):
A) Figure type:
   - "Academic paper methodology pipeline diagram"
   - Clean, minimal, PowerPoint-like flat vector style
B) Layout:
   - Landscape canvas, left-to-right pipeline
   - 3–6 major stages (columns), each stage has 2–6 sub-blocks
   - Avoid clutter: show only key steps and key logic
C) Visual grammar:
   - Distinguish Data blocks vs Process blocks:
     * Data: rounded rectangle, lighter fill
     * Process: sharp rectangle, slightly darker fill
   - Arrows show data/control flow clearly
   - Show loops with a curved arrow or labeled back-arrow ONLY if code contains loops (epoch/iter/refinement)
D) Text rules:
   - Short labels (1–5 words per line)
   - Keep text readable (no tiny fonts)
   - Use consistent naming that matches code identifiers when possible
E) "Key logic callouts" (IMPORTANT):
   - If code includes thresholds / filtering / selection / scoring / aggregation:
     add small callout boxes next to the relevant arrow or block.
     Example callouts: "score > τ", "top-k", "NMS", "normalize", "merge", "refine ×N"
   - If code includes multiple modes (train/eval/infer), show a branch with labeled arrows.
F) Title / subtitle:
   - Title: derive from code purpose (e.g., "CNN Training & Inference Pipeline")
   - Subtitle: include key modules (e.g., "Dataset → Model → Loss → Optimizer → Metrics")
G) Style constraints:
   - White or very light background
   - Thin consistent strokes
   - Minimal palette (2–4 accent colors max)
   - No gradients, no 3D, no decorative icons

OUTPUT STRUCTURE INSIDE YOUR FINAL IMAGE PROMPT:
Your final image prompt MUST include sections in this order:
1) Title
2) Overall style & layout
3) Stage-by-stage blocks and arrows (Stage 1..N)
4) Key logic callouts (thresholds/loops/filters/metrics)
5) Text and styling constraints (readability rules)

Remember: ONLY output the final image-generation prompt text.
`;

  // ✅ Model choice:
  // - If you want higher quality prompt writing, switch to "gpt-4.1"
  // - Currently: "gpt-4.1-mini" for speed/cost
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