import { NextResponse } from "next/server";
import { parse as parseYAML } from "yaml";



export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ====== 타입(가볍게) ====== */
type Blueprint = {
  meta?: { title?: string; source_image?: string; notes?: string };
  canvas: { width: number; height: number; aspect_ratio?: string };
  style?: {
    font_family?: string;
    font_size?: number;
    stroke?: string;
    stroke_width?: number;
    fills?: { primary?: string; secondary?: string; highlight?: string };
  };
  elements: Array<{
    id: string;
    type: string; // box, pill, note 등 확장
    x: number; y: number; w: number; h: number;
    fill?: string;
    stroke?: string;
    label_lines?: string[];
  }>;
  connectors: Array<{
    id: string;
    from: string;
    to: string;
    type?: string;   // straight, elbow 등
    anchor?: string; // auto, left/right/top/bottom
    label?: string;
  }>;
};

/** ====== 샘플 YAML (키 없어도 동작 확인용) ====== */
function sampleYaml(title: string, subtitle: string) {
  return `
meta:
  title: "${escapeYaml(title)}"
  source_image:
  notes: "${escapeYaml(subtitle)}"

canvas:
  width: 1200
  height: 720
  aspect_ratio: "5:3"

style:
  font_family: Arial
  font_size: 18
  stroke: "#E5E7EB"
  stroke_width: 2
  fills:
    primary: "#101A36"
    secondary: "#0B1020"
    highlight: "#22D3EE"

elements:
  - id: input
    type: box
    x: 120
    y: 220
    w: 420
    h: 200
    fill: "#101A36"
    stroke: "#E5E7EB"
    label_lines:
      - "Input"
      - "prompt + pdf text"
  - id: blueprint
    type: box
    x: 660
    y: 220
    w: 420
    h: 200
    fill: "#101A36"
    stroke: "#E5E7EB"
    label_lines:
      - "YAML Blueprint"
      - "elements + connectors"
  - id: output
    type: box
    x: 390
    y: 470
    w: 420
    h: 180
    fill: "#101A36"
    stroke: "#E5E7EB"
    label_lines:
      - "SVG Output"
      - "Editable in PowerPoint"

connectors:
  - id: c1
    from: input
    to: blueprint
    type: straight
    anchor: auto
    label: "extract"
  - id: c2
    from: blueprint
    to: output
    type: straight
    anchor: auto
    label: "render"
`.trim();
}

/** ====== POST 핸들러 ====== */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const prompt = typeof form.get("prompt") === "string" ? (form.get("prompt") as string) : "";

    // ✅ 키 없는 단계: prompt로 제목만 반영해서 샘플 YAML 생성
    const yamlText = sampleYaml(
      "paper2figure (YAML → SVG renderer ready)",
      prompt.trim() ? `prompt: ${prompt.trim().slice(0, 120)}` : "no prompt"
    );

    const blueprint = parseYAML(yamlText) as Blueprint;

    // 최소 검증
    if (!blueprint?.canvas?.width || !blueprint?.canvas?.height || !Array.isArray(blueprint.elements)) {
      return new NextResponse("Invalid blueprint YAML.", { status: 400 });
    }

    const svg = renderSvgFromBlueprint(blueprint);

    return new NextResponse(svg, {
      status: 200,
      headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
    });
  } catch (e: any) {
    return new NextResponse(e?.message || "Server error", { status: 500 });
  }
}

/** ====== 렌더러(핵심 2번) ====== */
function renderSvgFromBlueprint(bp: Blueprint) {
  const W = bp.canvas.width;
  const H = bp.canvas.height;

  const style = {
    font: bp.style?.font_family ?? "Arial",
    fontSize: bp.style?.font_size ?? 18,
    stroke: bp.style?.stroke ?? "#E5E7EB",
    strokeWidth: bp.style?.stroke_width ?? 2,
    fillPrimary: bp.style?.fills?.primary ?? "#101A36",
    fillSecondary: bp.style?.fills?.secondary ?? "#0B1020",
    highlight: bp.style?.fills?.highlight ?? "#22D3EE",
  };

  const title = bp.meta?.title ?? "";
  const notes = bp.meta?.notes ?? "";

  // 요소 id → 요소 map
  const nodeMap = new Map<string, Blueprint["elements"][number]>();
  for (const el of bp.elements) nodeMap.set(el.id, el);

  // 배경
  const bg = rect(0, 0, W, H, 0, style.fillSecondary, "none", 0);

  // 카드/프레임 (optional)
  const frame = rect(70, 90, W - 140, H - 160, 26, "#0F1730", style.highlight, 2, 0.35);

  // 타이틀 텍스트
  const header = `
    <g id="header">
      ${text(110, 165, title, style.font, 42, "#E5E7EB", 700)}
      ${text(110, 205, notes, style.font, 16, "#9CA3AF", 400)}
    </g>
  `;

  // 마커(arrowhead)
  const defs = `
  <defs>
    <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L12,6 L0,12 Z" fill="${style.highlight}" fill-opacity="0.65"/>
    </marker>
  </defs>
  `.trim();

  // 노드 렌더
  const nodesSvg = bp.elements
    .map((el) => renderNode(el, style))
    .join("\n");

  // 커넥터 렌더
  const edgesSvg = (bp.connectors ?? [])
    .map((c) => renderConnector(c, nodeMap, style))
    .join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${defs}
  <g id="canvas">
    ${bg}
    ${frame}
    ${header}
    <g id="edges">${edgesSvg}</g>
    <g id="nodes">${nodesSvg}</g>
  </g>
</svg>`;

  return svg;
}

function renderNode(
  el: Blueprint["elements"][number],
  style: { font: string; fontSize: number; stroke: string; strokeWidth: number; highlight: string; fillPrimary: string }
) {
  const fill = el.fill ?? style.fillPrimary;
  const stroke = el.stroke ?? style.stroke;

  // PPT 편집 편하게: 각 노드 그룹 id 고정
  const gid = `node_${sanitizeId(el.id)}`;

  const rx = el.type === "pill" ? Math.min(el.h / 2, 999) : 18;
  const outlineOpacity = 0.18;

  const box = rect(el.x, el.y, el.w, el.h, rx, fill, stroke, style.strokeWidth, outlineOpacity);

  // 라벨
  const lines = el.label_lines ?? [];
  const paddingX = 22;
  const paddingTop = 42;

  const lineGap = Math.round(style.fontSize * 1.25);
  const startY = el.y + paddingTop;

  const label = lines
    .map((ln, i) =>
      text(el.x + paddingX, startY + i * lineGap, ln, style.font, style.fontSize, "#E5E7EB", i === 0 ? 700 : 400)
    )
    .join("\n");

  return `
  <g id="${gid}">
    ${box}
    <g id="${gid}_label">
      ${label}
    </g>
  </g>
  `.trim();
}

function renderConnector(
  c: Blueprint["connectors"][number],
  nodeMap: Map<string, Blueprint["elements"][number]>,
  style: { highlight: string }
) {
  const from = nodeMap.get(c.from);
  const to = nodeMap.get(c.to);
  if (!from || !to) return "";

  const gid = `edge_${sanitizeId(c.id)}`;

  // anchor 자동: 중심에서 중심으로 가되, 박스 외곽에서 시작/끝하도록 계산
  const a = pickAnchor(from, to);
  const b = pickAnchor(to, from);

  const x1 = a.x, y1 = a.y;
  const x2 = b.x, y2 = b.y;

  // straight 기본
  const pathD = `M ${x1} ${y1} L ${x2} ${y2}`;

  const line = `<path d="${pathD}" stroke="${style.highlight}" stroke-opacity="0.55" stroke-width="3" fill="none" marker-end="url(#arrow)"/>`;

  // 라벨(중간)
  const label = c.label?.trim();
  const labelSvg = label
    ? `
      <g id="${gid}_label">
        <rect x="${(x1 + x2) / 2 - 36}" y="${(y1 + y2) / 2 - 14}" width="72" height="24" rx="10"
          fill="#0B1020" fill-opacity="0.75" stroke="rgba(229,231,235,0.16)" stroke-width="1"/>
        <text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + 4}" text-anchor="middle"
          font-family="Arial" font-size="12" fill="#E5E7EB">${escapeXml(label)}</text>
      </g>
    `
    : "";

  return `
  <g id="${gid}">
    ${line}
    ${labelSvg}
  </g>
  `.trim();
}

function pickAnchor(a: Blueprint["elements"][number], b: Blueprint["elements"][number]) {
  // a의 중심 기준으로 b가 어느 방향인지 보고 가장 자연스러운 변(edge) 선택
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;

  const dx = bx - ax;
  const dy = by - ay;

  // 가로가 더 크면 좌/우, 세로가 더 크면 상/하
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { x: a.x + a.w, y: ay } // right
      : { x: a.x, y: ay };      // left
  } else {
    return dy >= 0
      ? { x: ax, y: a.y + a.h } // bottom
      : { x: ax, y: a.y };      // top
  }
}

function rect(
  x: number, y: number, w: number, h: number,
  rx: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  strokeOpacity = 1
) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"
    fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"/>`;
}

function text(
  x: number, y: number, content: string,
  fontFamily: string,
  fontSize: number,
  fill: string,
  fontWeight: number
) {
  return `<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}"
    fill="${fill}" font-weight="${fontWeight}">${escapeXml(content)}</text>`;
}

function escapeXml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeYaml(s: string) {
  // 아주 간단한 YAML 문자열 escape (샘플용)
  return s.replaceAll('"', '\\"').replaceAll("\n", " ");
}

function sanitizeId(id: string) {
  return id.replace(/[^a-zA-Z0-9_\-]/g, "_");
}
