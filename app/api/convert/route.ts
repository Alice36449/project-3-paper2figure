import { NextResponse } from "next/server";
import { parse as parseYAML } from "yaml";
import OpenAI from "openai";

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

const SYSTEM_PROMPT = `
You are a diagram-to-YAML blueprint generator for academic / PowerPoint-style figures.

Goal:
- Given a user prompt describing a diagram, output ONLY a YAML blueprint that matches the schema below.
- The YAML will be rendered into editable SVG in PowerPoint, so keep shapes clean and minimal.

Hard constraints:
- Output MUST be valid YAML.
- Output MUST follow this schema exactly (fields, nesting).
- Do NOT output any explanation, code fences, markdown, or extra text. ONLY YAML.

Style goals:
- Prefer PowerPoint-like clean style: white background, thin borders, pastel fills.
- Avoid dark theme unless user explicitly asks for dark.
- Make labels short; if long, wrap into 1~2 lines.

Layout:
- Default left-to-right pipeline unless user requests top-down.
- Ensure all elements fit inside canvas (no cropping).
- Provide reasonable margins.

Schema:
meta:
  title:
  source_image:
  notes:

canvas:
  width:
  height:
  aspect_ratio:

style:
  font_family: Arial
  font_size:
  stroke:
  stroke_width: 2
  fills:
    primary:
    secondary:
    highlight:

elements:
  - id:
    type:
    x:
    y:
    w:
    h:
    fill:
    stroke:
    label_lines:

connectors:
  - id:
    from:
    to:
    type:
    anchor:
    label:
`.trim();

/** ====== POST 핸들러 ====== */
export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const prompt =
      typeof form.get("prompt") === "string" ? (form.get("prompt") as string) : "";

    const stylePreset =
      typeof form.get("stylePreset") === "string" ? (form.get("stylePreset") as string) : "ppt";

    const layout =
      typeof form.get("layout") === "string" ? (form.get("layout") as string) : "auto";

    const detailRaw =
      typeof form.get("detail") === "string" ? (form.get("detail") as string) : "70";
    const detail = Math.max(0, Math.min(100, Number(detailRaw) || 70));

    // 1) OpenAI로 YAML 생성 (가능하면)
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4.1";

    let yamlText: string | null = null;

    if (apiKey) {
      yamlText = await generateYamlWithOpenAI({
        apiKey,
        model,
        prompt,
        stylePreset,
        layout,
        detail,
      });
    }

    // 2) 실패/키없음 fallback
    if (!yamlText) {
      yamlText = buildYamlFromPrompt({ prompt, stylePreset, detail, layout });
    }

    const blueprint = parseYAML(yamlText) as Blueprint;

    if (
      !blueprint?.canvas?.width ||
      !blueprint?.canvas?.height ||
      !Array.isArray(blueprint.elements)
    ) {
      return new NextResponse("Invalid blueprint YAML.", { status: 400 });
    }

    // (중요) label_lines 정리: 혹시 \n 들어오면 분해
    blueprint.elements = blueprint.elements.map((e) => ({
      ...e,
      label_lines: normalizeLabelLines(e.label_lines),
    }));

    // 라이트 프리셋이면 자동으로 흰 배경/검은 글씨 느낌 보정
    if (isLightPreset(stylePreset)) {
      blueprint.style = blueprint.style || {};
      blueprint.style.font_family = blueprint.style.font_family || "Arial";
      blueprint.style.font_size = blueprint.style.font_size || 18;
      blueprint.style.stroke = blueprint.style.stroke || "#111827";
      blueprint.style.stroke_width = blueprint.style.stroke_width ?? 1.5;
      blueprint.style.fills = blueprint.style.fills || {};
      blueprint.style.fills.secondary = blueprint.style.fills.secondary || "#FFFFFF";
      blueprint.style.fills.highlight = blueprint.style.fills.highlight || "#111827";
      // primary는 “박스 기본색”으로 너무 하얗면 밋밋하니 아주 연한 회색을 기본으로
      blueprint.style.fills.primary = blueprint.style.fills.primary || "#F8FAFC";
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

/** ====== OpenAI 호출 ====== */
async function generateYamlWithOpenAI(args: {
  apiKey: string;
  model: string;
  prompt: string;
  stylePreset: string;
  layout: string;
  detail: number;
}): Promise<string | null> {
  try {
    const client = new OpenAI({ apiKey: args.apiKey });

    const userMsg = `
User prompt:
${args.prompt || "(empty)"}

UI options:
- stylePreset: ${args.stylePreset}
- layout: ${args.layout}
- detail: ${args.detail}

Important:
- Return ONLY YAML (no markdown, no code fence).
- Use white background + PowerPoint-like pastel style unless user asked for dark.
- Ensure everything fits in canvas.
`.trim();

    const resp = await client.chat.completions.create({
      model: args.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    if (!text) return null;

    // 가끔 모델이 ```yaml```을 붙이면 제거
    return stripCodeFences(text);
  } catch {
    return null;
  }
}

function stripCodeFences(s: string) {
  // ```yaml ... ``` 또는 ``` ... ``` 제거
  const t = s.trim();
  if (t.startsWith("```")) {
    return t.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return t;
}

/** ====== 렌더러 ====== */
function renderSvgFromBlueprint(bp: Blueprint) {
  const W = bp.canvas.width;
  const H = bp.canvas.height;

  const style = {
    font: bp.style?.font_family ?? "Arial",
    fontSize: bp.style?.font_size ?? 18,
    stroke: bp.style?.stroke ?? "#111827",
    strokeWidth: bp.style?.stroke_width ?? 1.5,
    fillPrimary: bp.style?.fills?.primary ?? "#F8FAFC",
    fillSecondary: bp.style?.fills?.secondary ?? "#FFFFFF",
    highlight: bp.style?.fills?.highlight ?? "#111827",
  };

  const title = (bp.meta?.title ?? "").trim();
  const notes = (bp.meta?.notes ?? "").trim();

  const isLight = isHexLight(style.fillSecondary);
  const bg = rect(0, 0, W, H, 0, style.fillSecondary, "none", 0);

  // 프레임: 라이트면 아주 연한 테두리만
  const frame = isLight
    ? rect(40, 40, W - 80, H - 80, 14, "none", "#E5E7EB", 1.2, 1)
    : rect(70, 90, W - 140, H - 160, 26, "#0F1730", style.highlight, 2, 0.35);

  // 제목 길이에 따라 폰트 자동 축소
  const titleFont = pickTitleFontSize(title);

  const titleColor = isLight ? "#111827" : "#E5E7EB";
  const notesColor = isLight ? "#374151" : "#9CA3AF";

  const header = `
    <g id="header">
      ${text(110, 140, truncate(title, 60), style.font, titleFont, titleColor, 700)}
      ${notes ? text(110, 170, truncate(notes, 120), style.font, 15, notesColor, 400) : ""}
    </g>
  `;

  // 마커 대신 화살촉 polygon으로 그릴 거라 defs 필요 없음
  const defs = ``;

  // 요소 id → map
  const nodeMap = new Map<string, Blueprint["elements"][number]>();
  for (const el of bp.elements) nodeMap.set(el.id, el);

  // 커넥터 먼저(뒤로 가게) → 노드 위로
  const edgesSvg = (bp.connectors ?? [])
    .map((c) => renderConnector(c, nodeMap, style, isLight))
    .join("\n");

  const nodesSvg = bp.elements
    .map((el) => renderNode(el, style, isLight))
    .join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
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
  style: { font: string; fontSize: number; stroke: string; strokeWidth: number; highlight: string; fillPrimary: string },
  isLightBg: boolean
) {
  const fill = el.fill && el.fill.trim() ? el.fill : style.fillPrimary;
  const stroke = el.stroke && el.stroke.trim() ? el.stroke : style.stroke;

  const gid = `node_${sanitizeId(el.id)}`;
  const rx = el.type === "pill" ? Math.min(el.h / 2, 999) : 14;

  const box = rect(el.x, el.y, el.w, el.h, rx, fill, stroke, style.strokeWidth, 1);

  // 텍스트 색 자동: 박스가 밝으면 검정, 어두우면 흰색
  const textColor = isHexLight(fill) ? "#111827" : (isLightBg ? "#111827" : "#E5E7EB");

  const lines = normalizeLabelLines(el.label_lines);
  const paddingX = 18;
  const paddingTop = 36;

  const lineGap = Math.round(style.fontSize * 1.25);
  const startY = el.y + paddingTop;

  const label = lines
    .slice(0, 3)
    .map((ln, i) =>
      text(el.x + paddingX, startY + i * lineGap, ln, style.font, style.fontSize, textColor, i === 0 ? 700 : 400)
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
  style: { highlight: string },
  isLightBg: boolean
) {
  const from = nodeMap.get(c.from);
  const to = nodeMap.get(c.to);
  if (!from || !to) return "";

  const gid = `edge_${sanitizeId(c.id)}`;

  const a = pickAnchor(from, to);
  const b = pickAnchor(to, from);

  const x1 = a.x, y1 = a.y;
  const x2 = b.x, y2 = b.y;

  // 선
  const line = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${style.highlight}" stroke-width="2" stroke-opacity="0.9"/>`;

  // 화살촉: marker 금지라 polygon 직접
  const head = arrowHeadPolygon(x1, y1, x2, y2, 12, 8, style.highlight);

  // 라벨
  const label = (c.label ?? "").trim();
  const labelSvg = label
    ? (() => {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const boxW = 76;
        const boxH = 22;
        const fill = isLightBg ? "#FFFFFF" : "#0B1020";
        const stroke = isLightBg ? "#E5E7EB" : "rgba(229,231,235,0.16)";
        const textColor = isLightBg ? "#111827" : "#E5E7EB";
        return `
          <g id="${gid}_label">
            <rect x="${Math.round(mx - boxW / 2)}" y="${Math.round(my - boxH / 2)}" width="${boxW}" height="${boxH}" rx="10"
              fill="${fill}" stroke="${stroke}" stroke-width="1"/>
            ${text(Math.round(mx - boxW / 2 + 10), Math.round(my + 5), truncate(label, 18), "Arial", 12, textColor, 600)}
          </g>
        `.trim();
      })()
    : "";

  return `
  <g id="${gid}">
    ${line}
    ${head}
    ${labelSvg}
  </g>
  `.trim();
}

function pickAnchor(a: Blueprint["elements"][number], b: Blueprint["elements"][number]) {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;

  const dx = bx - ax;
  const dy = by - ay;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { x: a.x + a.w, y: ay } : { x: a.x, y: ay };
  } else {
    return dy >= 0 ? { x: ax, y: a.y + a.h } : { x: ax, y: a.y };
  }
}

function arrowHeadPolygon(x1: number, y1: number, x2: number, y2: number, len: number, width: number, color: string) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  // 끝점 기준
  const px = x2;
  const py = y2;

  // 뒤로 len 만큼
  const bx = px - ux * len;
  const by = py - uy * len;

  // 수직 벡터
  const vx = -uy;
  const vy = ux;

  const leftX = bx + vx * (width / 2);
  const leftY = by + vy * (width / 2);
  const rightX = bx - vx * (width / 2);
  const rightY = by - vy * (width / 2);

  return `<polygon points="${Math.round(px)},${Math.round(py)} ${Math.round(leftX)},${Math.round(leftY)} ${Math.round(rightX)},${Math.round(rightY)}" fill="${color}"/>`;
}

function rect(
  x: number, y: number, w: number, h: number,
  rx: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  strokeOpacity = 1
) {
  return `<rect x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(w)}" height="${Math.round(h)}" rx="${Math.round(rx)}"
    fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"/>`;
}

function text(
  x: number, y: number, content: string,
  fontFamily: string,
  fontSize: number,
  fill: string,
  fontWeight: number
) {
  return `<text x="${Math.round(x)}" y="${Math.round(y)}" font-family="${fontFamily}" font-size="${fontSize}"
    fill="${fill}" font-weight="${fontWeight}">${escapeXml(content)}</text>`;
}

function escapeXml(s: string) {
  return (s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sanitizeId(id: string) {
  return (id ?? "").replace(/[^a-zA-Z0-9_\-]/g, "_");
}

function truncate(s: string, max: number) {
  const t = (s ?? "").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function pickTitleFontSize(title: string) {
  const n = (title ?? "").length;
  if (n <= 26) return 44;
  if (n <= 36) return 38;
  if (n <= 48) return 32;
  return 28;
}

function normalizeLabelLines(lines?: string[]) {
  const raw = Array.isArray(lines) ? lines : [];
  const flat = raw.flatMap((l) => (l ?? "").split("\n")).map((s) => s.trim()).filter(Boolean);
  return flat.length ? flat : ["(untitled)"];
}

function isLightPreset(preset: string) {
  const p = (preset || "").toLowerCase();
  return p === "ppt" || p === "light";
}

function isHexLight(hex: string) {
  const h = (hex || "").trim().toLowerCase();
  if (!h.startsWith("#") || (h.length !== 7 && h.length !== 4)) return false;

  const rgb = h.length === 4
    ? [h[1] + h[1], h[2] + h[2], h[3] + h[3]]
    : [h.slice(1, 3), h.slice(3, 5), h.slice(5, 7)];

  const r = parseInt(rgb[0], 16);
  const g = parseInt(rgb[1], 16);
  const b = parseInt(rgb[2], 16);

  // 상대 휘도 근사
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum >= 170;
}

/** ====== fallback: 로컬 규칙 기반 YAML 생성 ====== */
type BuildArgs = {
  prompt: string;
  stylePreset?: string;
  detail?: number;
  layout?: string;
};

function buildYamlFromPrompt(args: BuildArgs) {
  const raw = (args.prompt || "").trim();
  const stylePreset = (args.stylePreset || "ppt").toLowerCase();
  const detail = clampNumber(args.detail ?? 70, 0, 100);
  const layout = (args.layout || "auto").toLowerCase();

  const steps = parseSteps(raw);
  const nodes = steps.length ? steps : ["Input", "Process", "Output"];

  const dir: "left-to-right" | "top-down" = layout === "top-down" ? "top-down" : "left-to-right";

  const canvas = pickCanvas(nodes.length, dir);
  const style = pickStyle(stylePreset);

  const elements = autoLayoutElements(nodes, {
    dir,
    canvasW: canvas.width,
    canvasH: canvas.height,
    withDesc: detail >= 60,
    stylePreset,
  });

  const connectors: any[] = [];
  for (let i = 0; i < elements.length - 1; i++) {
    connectors.push({
      id: `c${i + 1}`,
      from: elements[i].id,
      to: elements[i + 1].id,
      type: "straight",
      anchor: "auto",
      label: "",
    });
  }

  const title = truncate(nodes.length <= 5 ? nodes.join(" → ") : `${nodes[0]} → … → ${nodes[nodes.length - 1]}`, 60);
  const notes = raw ? `prompt: ${truncate(raw.replace(/\s+/g, " "), 120)}` : "no prompt";

  const yaml = `
meta:
  title: "${escapeYaml(title)}"
  source_image:
  notes: "${escapeYaml(notes)}"

canvas:
  width: ${canvas.width}
  height: ${canvas.height}
  aspect_ratio: "${canvas.aspect}"

style:
  font_family: Arial
  font_size: ${style.font_size}
  stroke: "${style.stroke}"
  stroke_width: ${style.stroke_width}
  fills:
    primary: "${style.fills.primary}"
    secondary: "${style.fills.secondary}"
    highlight: "${style.fills.highlight}"

elements:
${elements.map((e) => elementYaml(e)).join("\n")}

connectors:
${connectors.map((c) => connectorYaml(c)).join("\n")}
`.trim();

  return yaml;
}

function parseSteps(prompt: string): string[] {
  if (!prompt) return [];

  if (prompt.includes("->") || prompt.includes("→")) {
    const arrow = prompt.includes("->") ? "->" : "→";
    const parts = prompt.split(arrow).map((s) => s.trim()).filter(Boolean);
    return normalizeLabels(parts);
  }

  const lines = prompt.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const bulletRe = /^(\d+[\).\]]\s+|[-*•]\s+)/;
  const hadBullet = lines.some((l) => bulletRe.test(l));

  const bulletLines = lines
    .map((l) => l.replace(bulletRe, "").trim())
    .filter((l) => l.length > 0);

  if (hadBullet && bulletLines.length >= 2) return normalizeLabels(bulletLines);
  if (lines.length >= 2) return normalizeLabels(lines);
  return [];
}

function normalizeLabels(labels: string[]) {
  return labels.map((s) => {
    const t = s.replace(/\s+/g, " ").trim();
    const lines = wrapToLines(t, 22, 2);
    return lines.join("\n");
  });
}

function pickCanvas(n: number, dir: "left-to-right" | "top-down") {
  // “안 잘리게” 넉넉하게: n이 늘면 가로/세로 확장
  const baseW = 1400;
  const baseH = 700;

  if (dir === "top-down") {
    const h = Math.max(baseH, 220 + n * 180);
    return { width: baseW, height: h, aspect: "auto" };
  } else {
    const w = Math.max(baseW, 200 + n * 420);
    return { width: w, height: baseH, aspect: "auto" };
  }
}

function pickStyle(preset: string) {
  if (preset === "ppt" || preset === "light") {
    return {
      font_size: 18,
      stroke: "#111827",
      stroke_width: 1.5,
      fills: {
        primary: "#F8FAFC",
        secondary: "#FFFFFF",
        highlight: "#111827",
      },
    };
  }
  // dark fallback
  return {
    font_size: 18,
    stroke: "#E5E7EB",
    stroke_width: 2,
    fills: {
      primary: "#101A36",
      secondary: "#0B1020",
      highlight: "#22D3EE",
    },
  };
}

function autoLayoutElements(
  labels: string[],
  opts: { dir: "left-to-right" | "top-down"; canvasW: number; canvasH: number; withDesc: boolean; stylePreset: string }
) {
  const { dir, canvasW, canvasH } = opts;

  const marginX = 110;
  const marginY = 240;

  const boxW = 360;
  const boxH = 140;

  const gapX = 120;
  const gapY = 90;

  const elements: Array<any> = [];

  if (dir === "top-down") {
    let x = Math.max(80, Math.floor((canvasW - boxW) / 2));
    let y = marginY;

    labels.forEach((lab, i) => {
      elements.push({
        id: `n${i + 1}`,
        type: "box",
        x,
        y,
        w: boxW,
        h: boxH,
        // ppt 느낌: 연파/연초/연주 톤을 번갈아
        fill: pickPastel(i),
        stroke: "",
        label_lines: lab.split("\n"),
      });
      y += boxH + gapY;
    });
  } else {
    let x = marginX;
    let y = Math.max(240, Math.floor((canvasH - boxH) / 2));

    labels.forEach((lab, i) => {
      elements.push({
        id: `n${i + 1}`,
        type: "box",
        x,
        y,
        w: boxW,
        h: boxH,
        fill: pickPastel(i),
        stroke: "",
        label_lines: lab.split("\n"),
      });
      x += boxW + gapX;
    });
  }

  return elements;
}

function pickPastel(i: number) {
  const palette = ["#E8F0FE", "#E8F5E9", "#FFF3E0", "#E3F2FD", "#F3E5F5"];
  return palette[i % palette.length];
}

function elementYaml(e: any) {
  const lines = Array.isArray(e.label_lines) ? e.label_lines : [];
  return `  - id: ${e.id}
    type: ${e.type}
    x: ${Math.round(e.x)}
    y: ${Math.round(e.y)}
    w: ${Math.round(e.w)}
    h: ${Math.round(e.h)}
    fill: "${escapeYaml(e.fill ?? "")}"
    stroke: "${escapeYaml(e.stroke ?? "")}"
    label_lines:
${lines.map((l: string) => `      - "${escapeYaml(l)}"`).join("\n")}`;
}

function connectorYaml(c: any) {
  return `  - id: ${c.id}
    from: ${c.from}
    to: ${c.to}
    type: ${c.type ?? "straight"}
    anchor: ${c.anchor ?? "auto"}
    label: "${escapeYaml(c.label ?? "")}"`;
}

function escapeYaml(s: string) {
  return (s ?? "").replaceAll('"', '\\"').replaceAll("\n", " ");
}

function clampNumber(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function wrapToLines(text: string, maxCharsPerLine: number, maxLines: number) {
  const words = (text ?? "").split(" ");
  const lines: string[] = [];
  let cur = "";

  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxCharsPerLine) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);

  const joined = lines.join(" ");
  if (joined.length < text.length) {
    const idx = Math.min(lines.length, maxLines) - 1;
    const last = lines[idx] ?? "";
    lines[idx] = last.length > 1 ? last.slice(0, Math.max(1, last.length - 1)) + "…" : "…";
  }

  return lines.slice(0, maxLines);
}
