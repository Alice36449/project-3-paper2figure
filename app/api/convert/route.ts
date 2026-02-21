// app/api/convert/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { runPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    // =========================================================
    // #1. Input: accept ONLY .py (multipart/form-data)
    // =========================================================
    const form = await req.formData();

    const file = form.get("file");
    const vectorizeMode = String(form.get("vectorizeMode") || "cutouts"); // "cutouts" | "stacked"

    // ✅ NEW: optional directive (1-line)
    const directive = String(form.get("directive") || "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A .py file is required." }, { status: 400 });
    }

    const filename = file.name || "";
    if (!filename.toLowerCase().endsWith(".py")) {
      return NextResponse.json({ error: "Only .py files are accepted." }, { status: 400 });
    }

    if (vectorizeMode !== "cutouts" && vectorizeMode !== "stacked") {
      return NextResponse.json(
        { error: "Invalid vectorize mode. Use 'cutouts' or 'stacked'." },
        { status: 400 }
      );
    }

    const codeText = await file.text();
    if (!codeText.trim()) {
      return NextResponse.json({ error: "Uploaded .py file is empty." }, { status: 400 });
    }

    // =========================================================
    // #2~#4. Run pipeline (prompt -> png -> svg)
    // =========================================================
    const result = await runPipeline({
      openai,
      codeText,
      vectorizeMode,
      directive, // ✅ pass through
    });

    // =========================================================
    // #5. Output: JSON for UI
    // =========================================================
    return NextResponse.json(
      {
        promptText: result.promptText,
        pngBase64: result.pngBase64,
        svgText: result.svgText,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}