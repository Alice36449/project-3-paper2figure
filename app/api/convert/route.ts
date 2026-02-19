import OpenAI from "openai";

export const runtime = "nodejs"; // 중요: openai sdk는 node runtime 권장

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// PNG dataURL을 감싸는 "wrapper SVG" 생성
function wrapPngDataUrlToSvg(pngDataUrl: string, width: number, height: number) {
  // NOTE: href에 data:image/png;base64,... 를 그대로 넣는 방식
  //       너 UI는 svgText만 렌더하면 되므로 가장 덜 건드리는 해결책.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${width}" height="${height}"
     viewBox="0 0 ${width} ${height}">
  <image href="${pngDataUrl}"
         x="0" y="0"
         width="${width}" height="${height}"
         preserveAspectRatio="xMidYMid meet" />
</svg>`;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const prompt = String(form.get("prompt") ?? "").trim();

    // file은 지금 단계에서는 안 써도 됨 (UI 건드리지 말랬으니)
    // const file = form.get("file") as File | null;

    if (!prompt) {
      return new Response("No prompt", { status: 400 });
    }

    // ✅ 이미지 모델로 "포스터급" 생성
    const img = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1536x1024",
      quality: "high",
      background: "opaque",
    });

    const b64 = img.data?.[0]?.b64_json;
    if (!b64) {
      return new Response("Image generation failed: no b64 returned", { status: 500 });
    }

    const pngDataUrl = `data:image/png;base64,${b64}`;

    // ✅ 프론트는 SVG 텍스트를 기대하므로, PNG를 SVG로 감싸서 반환
    const svg = wrapPngDataUrlToSvg(pngDataUrl, 1536, 1024);

    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(e?.message ?? "Internal error", { status: 500 });
  }
}
