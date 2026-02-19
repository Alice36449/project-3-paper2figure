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

    // 파일이 있으면 텍스트로 읽어서 프롬프트에 붙임
    if (file instanceof File) {
      // 파일 타입이 이미지/pdf면 지금은 에러로 보내는 게 안전
      const mime = (file.type || "").toLowerCase();
      const isProbablyText =
        mime.startsWith("text/") ||
        mime.includes("json") ||
        mime.includes("yaml") ||
        mime.includes("toml") ||
        mime === "" || // 일부 코드 파일은 mime 빈 값
        /\.(txt|md|py|js|ts|tsx|jsx|java|c|cpp|h|hpp|rs|go|yaml|yml|json|toml|ini)$/i.test(file.name);

      if (!isProbablyText) {
        return new NextResponse(
          "현재 버전은 텍스트/코드 파일만 지원합니다. (이미지/PDF는 다음 단계에서 추가)",
          { status: 400 }
        );
      }

      const fileText = await readFileAsText(file);
      inputText = [
        inputText ? `[USER PROMPT]\n${inputText}` : "",
        `[FILE: ${file.name}]\n${fileText}`,
      ]
        .filter(Boolean)
        .join("\n\n---\n\n");
    }

    inputText = clampString(inputText, MAX_INPUT_CHARS).trim();
    if (!inputText) {
      return new NextResponse("prompt 또는 텍스트 파일을 입력해줘.", { status: 400 });
    }

    const client = new OpenAI({ apiKey });

    // ✅ “지피티처럼” 만들려면:
    // - system에 규칙을 강하게 고정
    // - temperature 낮게(0.1~0.3)로 안정성
    // - 필요하면 2-pass(규칙검사 실패 시 “규칙 위반만 수정” 재요청)도 가능
    const resp = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: HARD_SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(inputText) },
      ],
    });

    let svg = (resp.choices?.[0]?.message?.content || "").trim();
    if (!svg) throw new Error("OpenAI 응답이 비었습니다.");

    // 혹시라도 코드펜스가 섞이면 제거(안 섞이게 system에 금지했지만 방어)
    svg = svg.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();

    // ✅ 1차 검증
    try {
      validateSvgOrThrow(svg);
    } catch (e: any) {
      // ✅ 2차 수정 시도: “규칙 위반만 고쳐서 SVG만 다시 출력”
      const fixResp = await client.chat.completions.create({
        model: DEFAULT_MODEL,
        temperature: 0.1,
        messages: [
          { role: "system", content: HARD_SYSTEM_PROMPT },
          {
            role: "user",
            content: `
아래 SVG가 규칙을 위반했다. "내용/레이아웃 의도는 유지"하면서 규칙을 만족하도록 수정해서
오직 SVG 문자열만 다시 출력하라.

[위반/에러]
${String(e?.message || e)}

[SVG 원문]
${svg}
`.trim(),
          },
        ],
      });

      svg = (fixResp.choices?.[0]?.message?.content || "").trim();
      svg = svg.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
      validateSvgOrThrow(svg);
    }

    return new NextResponse(svg, {
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

