// app/api/convert/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ✅ 목표:
 * - 사용자가 입력한 "코드/프롬프트"를 기반으로
 * - route.ts에 하드코딩된 규칙(논문/발표용, PPT-friendly SVG 규칙)을 강제로 적용해서
 * - OpenAI가 SVG를 직접 생성해서 반환
 *
 * ✅ 안전장치:
 * - SVG 금지 요소(viewBox/transform/marker/tspan/clipPath/mask/filter/foreignObject 등) 검사
 * - SVG 루트/width/height 존재 검사
 * - 너무 긴 출력(토큰 폭주) 제한
 */

const MAX_INPUT_CHARS = 60_000;      // 사용자가 넣는 코드/프롬프트 최대 길이(과도한 토큰 방지)
const MAX_SVG_CHARS = 220_000;       // SVG 결과 최대 길이(과도한 응답 방지)
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

// ✅ 너가 말한 “하드코딩 규칙/절차”를 system으로 고정
// (한국어 가능. 오히려 한글 규칙일수록 일관성 좋음)
const HARD_SYSTEM_PROMPT = `
너는 코드/텍스트 기반으로 "논문/발표용 블록 다이어그램"을 생성하는 전문가다.
사용자 입력은 논문 코드/설명/프롬프트일 수 있다.

반드시 아래 규칙을 지켜 SVG를 직접 출력하라.
출력은 오직 SVG 문자열만. (마크다운/설명/코드펜스/JSON/YAML 금지)

[핵심 원칙]
- 결과물은 PowerPoint에서 편집 가능한 SVG여야 한다.
- 텍스트는 <text>로 유지하고 path 변환 금지.
- 레이아웃은 겹침/잘림이 없도록 충분한 여백과 박스 크기로 설계.

[SVG 작성 규칙: 반드시 준수]
1) viewBox 사용 금지
2) transform 사용 금지
3) marker 사용 금지 (화살촉은 polygon으로 직접)
4) tspan 사용 금지 (멀티라인은 <text> 여러 개)
5) text-anchor / dominant-baseline 사용 금지
6) clipPath/mask/filter/foreignObject 사용 금지
7) CSS 클래스 사용 금지 (인라인 속성만)
8) 가능한 도형: rect / line / polygon / circle / text 만 사용
9) 모든 좌표는 절대좌표로 작성 (그룹 <g>는 필요 시만)

[스타일 (PPT스럽게)]
- 흰 배경
- 파스텔 톤 박스(fill: 연한 색), 얇은 테두리(stroke: #CBD5E1 정도)
- 각진 사각형(라운드 너무 크게 X): rx 8~12 정도
- 폰트: Arial
- 폰트 크기: 기본 16, 제목 26~30

[레이아웃 기본]
- 좌->우 흐름(기본)
- 입력이 "A -> B -> C" 같은 간단 체인이면, 그 단계 수에 맞춰 컬럼을 맞춘다.
- 사용자가 "3스테이지"를 원하면 절대 4스테이지로 임의 확장하지 않는다.
- 단계(스테이지) 수를 입력에서 추정할 수 없으면, 사용자 입력의 단계 수(화살표 개수/불릿)를 우선한다.

[출력 형식]
- 반드시 <svg xmlns="http://www.w3.org/2000/svg" width="..." height="..."> 로 시작
- width/height는 내용에 맞는 적절한 픽셀값(예: 1200x700~1600x900)
- 배경 rect 포함 권장
`.trim();

// ✅ user prompt 템플릿: 여기서 사용자 입력을 끼워넣음
function buildUserPrompt(userText: string) {
  return `
[사용자 입력(코드/프롬프트/설명)]
${userText}

[요구]
- 사용자 입력을 기반으로 블록 다이어그램을 생성하라.
- 스테이지(컬럼) 수는 사용자 입력을 우선한다.
- 각 박스 텍스트는 짧게, 줄바꿈은 여러 <text>로.
- 화살표는 line + polygon 화살촉으로.
- 겹침/잘림이 없게 캔버스/박스 크기를 충분히 잡아라.
- 출력은 오직 SVG 문자열만.
`.trim();
}

async function readFileAsText(file: File) {
  // 텍스트/코드 위주로 받는다고 가정 (PDF/이미지는 지금 단계에서 무시하거나 에러 처리)
  // 필요하면 PDF는 별도 파서 붙이는게 좋음.
  const buf = Buffer.from(await file.arrayBuffer());
  // UTF-8 우선
  return buf.toString("utf8");
}

function clampString(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n\n...[truncated]";
}

/** ✅ 결과가 SVG인지 최소 검증 + 금지 태그 방어 */
function validateSvgOrThrow(svg: string) {
  const t = (svg || "").trim();

  if (!t.startsWith("<svg") && !t.startsWith("<?xml")) {
    throw new Error("OpenAI 응답이 SVG로 시작하지 않습니다.");
  }
  if (!t.includes("<svg")) throw new Error("SVG 태그가 없습니다.");
  if (!/width="[^"]+"/.test(t) || !/height="[^"]+"/.test(t)) {
    throw new Error('SVG에 width/height 속성이 없습니다. (viewBox는 금지)');
  }

  // 금지 요소들
  const forbidden = [
    /viewBox=/i,
    /transform=/i,
    /<marker\b/i,
    /<tspan\b/i,
    /text-anchor=/i,
    /dominant-baseline=/i,
    /<clipPath\b/i,
    /<mask\b/i,
    /<filter\b/i,
    /<foreignObject\b/i,
    /class="/i, // CSS 클래스 금지
  ];

  const hit = forbidden.find((re) => re.test(t));
  if (hit) {
    throw new Error(`SVG 규칙 위반 요소가 포함됨: ${hit}`);
  }

  if (t.length > MAX_SVG_CHARS) {
    throw new Error(`SVG가 너무 큽니다. (${t.length} chars)`);
  }
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new NextResponse("OPENAI_API_KEY is missing in environment variables.", { status: 500 });
    }

    const form = await req.formData();
    const prompt = typeof form.get("prompt") === "string" ? String(form.get("prompt")) : "";
    const file = form.get("file");

    let inputText = (prompt || "").trim();

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
      headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
    });
  } catch (e: any) {
    return new NextResponse(e?.message || "Server error", { status: 500 });
  }
}
