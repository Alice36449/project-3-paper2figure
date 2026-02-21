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
    const prompt = String(form.get("prompt") ?? "").trim();

    // 지금은 "이 파이프라인 포스터" 전용 템플릿.
    // 프롬프트는 일단 제목/표현만 활용 (원하면 다음 단계로: prompt->spec->render 확장)
    const title =
      prompt.length > 0
        ? "A Few-Shot Object Detection and Instance Segmentation Pipeline using OWL-ViT, CLIP-based Filtering, and Iterative SAM Refinement"
        : "paper2figure diagram";

    const svg = buildPosterSvg(title);

    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}