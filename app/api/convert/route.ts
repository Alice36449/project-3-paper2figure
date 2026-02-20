import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    if (!prompt || !prompt.trim()) {
      return new NextResponse("프롬프트를 입력해줘.", { status: 400 });
    }

    // 🔥 이미지 생성
    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024", // 필요하면 변경
    });

    const image_base64 = result.data?.[0]?.b64_json;

    if (!image_base64) {
      throw new Error("이미지 생성 실패");
    }

    const imageBuffer = Buffer.from(image_base64, "base64");

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error(e);
    return new NextResponse(e?.message ?? "Internal error", {
      status: 500,
    });
  }
}


