// app/api/convert/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** =========================
 *  Types
 * ========================= */
type Blueprint = {
  meta?: { title?: string; notes?: string };
  canvas: { width: number; height: number; aspect_ratio?: string };
  style?: {
    font_family?: string;
    font_size?: number;
    stroke?: string;
    stroke_width?: number;
  };
  elements: Array<{
    id: string;
    type: string; // stagePanel | stageHeader | box | pill
    x: number;
    y: number;
    w: number;
    h: number;
    fill?: string;
    stroke?: string;
    label_lines?: string[];
    meta?: Record<string, any>;
  }>;
  connectors: Array<{
    id: string;
    from: string;
    to: string;
    type?: string; // straight | elbow
    label?: string;
  }>;
};

// 동적 스테이지(2~6 정도)
type SemanticBlueprint = {
  title: string;
  stageCount: number;
  stages: Array<{ id: string; title: string }>;
  nodes: Array<{
    id: string;
    stageId: string;
    kind: "data" | "process" | "model" | "function" | "output" | "note";
    label: string;
    sublabel?: string;
    order: number;
  }>;
  edges: Array<{ id: string; from: string; to: string; label?: string }>;
};

/** =========================
 *  OpenAI prompt
 * ========================= */
const SEMANTIC_SYSTEM_PROMPT = `
You generate a "semantic blueprint" for an academic PowerPoint-style pipeline diagram.
Return ONLY valid JSON. No markdown, no code fences, no explanation.

Hard rules:
- No pixel coordinates. No canvas sizes.
- stageCount is provided by the user message. You MUST follow it.
- stages array length MUST equal stageCount.
- stage ids must be "s1","s2",...,"sN".
- nodes must belong to one stageId and have integer order (top-to-bottom).
- Keep labels short. Avoid paragraphs.
- Prefer a left-to-right pipeline.

JSON schema:
{
  "title": string,
  "stageCount": number,
  "stages": [{"id":"s1","title":string}, ...],
  "nodes": [{"id":string,"stageId":"s1".."sN","kind":"data"|"process"|"model"|"function"|"output"|"note","label":string,"sublabel"?:string,"order":number}, ...],
  "edges": [{"id":string,"from":string,"to":string,"label"?:string}, ...]
}
`.trim();

/** =========================
 *  Handler
 * ========================= */
export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const prompt = typeof form.get("prompt") === "string" ? String(form.get("prompt")) : "";
    const stylePresetRaw = typeof form.get("stylePreset") === "string" ? String(form.get("stylePreset")) : "ppt";
    const stylePreset = stylePresetRaw.trim().toLowerCase(); // "ppt" | "dark" etc

    const layoutRaw = typeof form.get("layout") === "string" ? String(form.get("layout")) : "auto";
    const layout = layoutRaw.trim().toLowerCase();

    const detailRaw = typeof form.get("detail") === "string" ? String(form.get("detail")) : "70";
    const detail = clampNumber(Number(detailRaw) || 70, 0, 100);

    const stageCount = detectStageCount(prompt); // ✅ 3-stage 요청하면 3으로

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    let semantic: SemanticBlueprint | null = null;

    if (apiKey) {
      semantic = await generateSemanticWithOpenAI({
        apiKey,
        model,
        prompt,
        stylePreset,
        layout,
        detail,
        stageCount,
      });
    }

    if (!semantic) {
      semantic = buildSemanticFallback({ prompt, detail, stageCount });
    }

    const bp = buildLayoutBlueprint(semantic, { stylePreset, layout, detail });
    const svg = renderSvgFromBlueprint(bp, stylePreset);

    return new NextResponse(svg, {
      status: 200,
      headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
    });
  } catch (e: any) {
    return new NextResponse(e?.message || "Server error", { status: 500 });
  }
}

/** =========================
 *  OpenAI semantic JSON
 * ========================= */
async function generateSemanticWithOpenAI(args: {
  apiKey: string;
  model: string;
  prompt: string;
  stylePreset: string;
  layout: string;
  detail: number;
  stageCount: number;
}): Promise<SemanticBlueprint | null> {
  try {
    const client = new OpenAI({ apiKey: args.apiKey });

    const userMsg = `
User prompt:
${args.prompt || "(empty)"}

Constraints:
- stageCount: ${args.stageCount} (MUST follow)
- layout: left-to-right pipeline
- keep labels short
Return ONLY JSON.
`.trim();

    const resp = await client.chat.completions.create({
      model: args.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: SEMANTIC_SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
    });

    const text = (resp.choices?.[0]?.message?.content || "").trim();
    if (!text) return null;

    const jsonText = stripCodeFences(text);
    const parsed = safeJsonParse(jsonText);
    if (!parsed) return null;

    return normalizeSemantic(parsed, args.stageCount);
  } catch {
    return null;
  }
}

/** =========================
 *  Normalize / validation
 * ========================= */
function normalizeSemantic(raw: any, stageCountExpected: number): SemanticBlueprint | null {
  if (!raw || typeof raw !== "object") return null;

  const title = typeof raw.title === "string" ? raw.title.trim() : "Pipeline Diagram";
  const stageCount = clampNumber(Number(raw.stageCount) || stageCountExpected, 2, 6);

  // stage ids: s1..sN
  const stageIds = new Set(Array.from({ length: stageCount }, (_, i) => `s${i + 1}`));
  const stagesIn = Array.isArray(raw.stages) ? raw.stages : [];

  // force correct length
  const stages: SemanticBlueprint["stages"] = [];
  for (let i = 0; i < stageCount; i++) {
    const sid = `s${i + 1}`;
    const found = stagesIn.find((x: any) => x?.id === sid);
    const t = typeof found?.title === "string" ? found.title.trim() : `Stage ${i + 1}`;
    stages.push({ id: sid, title: t || `Stage ${i + 1}` });
  }

  const nodesRaw = Array.isArray(raw.nodes) ? raw.nodes : [];
  const nodes: SemanticBlueprint["nodes"] = [];
  for (const n of nodesRaw) {
    if (!n || typeof n !== "object") continue;
    const id = typeof n.id === "string" ? sanitizeId(n.id.trim()) : "";
    const stageId = typeof n.stageId === "string" ? n.stageId.trim() : "s1";
    const kind = typeof n.kind === "string" ? n.kind.trim() : "process";
    const label = typeof n.label === "string" ? n.label.trim() : "";
    const sublabel = typeof n.sublabel === "string" ? n.sublabel.trim() : undefined;
    const order = Number.isFinite(n.order) ? Math.max(1, Math.floor(n.order)) : 1;

    if (!id || !stageIds.has(stageId) || !label) continue;
    if (!["data", "process", "model", "function", "output", "note"].includes(kind)) continue;

    nodes.push({ id, stageId, kind: kind as any, label, sublabel, order });
  }

  if (nodes.length < 2) {
    return buildSemanticFallback({ prompt: title, detail: 70, stageCount });
  }

  const edgesRaw = Array.isArray(raw.edges) ? raw.edges : [];
  const edges: SemanticBlueprint["edges"] = [];
  const nodeIdSet = new Set(nodes.map((n) => n.id));

  for (const e of edgesRaw) {
    if (!e || typeof e !== "object") continue;
    const id = typeof e.id === "string" ? sanitizeId(e.id.trim()) : "";
    const from = typeof e.from === "string" ? sanitizeId(e.from.trim()) : "";
    const to = typeof e.to === "string" ? sanitizeId(e.to.trim()) : "";
    const label = typeof e.label === "string" ? e.label.trim() : undefined;
    if (!id || !nodeIdSet.has(from) || !nodeIdSet.has(to)) continue;
    edges.push({ id, from, to, label });
  }

  const edgesFinal = edges.length ? edges : autoEdgesByStageOrder(nodes, stageCount);

  return { title, stageCount, stages, nodes, edges: edgesFinal };
}

function autoEdgesByStageOrder(nodes: SemanticBlueprint["nodes"], stageCount: number): SemanticBlueprint["edges"] {
  const byStage: Record<string, SemanticBlueprint["nodes"]> = {};
  for (let i = 1; i <= stageCount; i++) byStage[`s${i}`] = [];
  for (const n of nodes) byStage[n.stageId].push(n);
  for (const k of Object.keys(byStage)) byStage[k].sort((a, b) => a.order - b.order);

  const edges: SemanticBlueprint["edges"] = [];
  // inside stage
  for (let s = 1; s <= stageCount; s++) {
    const sid = `s${s}`;
    const arr = byStage[sid];
    for (let i = 0; i < arr.length - 1; i++) {
      edges.push({ id: `e_${sid}_${i + 1}`, from: arr[i].id, to: arr[i + 1].id });
    }
  }
  // stage to stage (last -> first)
  for (let s = 1; s < stageCount; s++) {
    const a = byStage[`s${s}`];
    const b = byStage[`s${s + 1}`];
    if (a.length && b.length) edges.push({ id: `e_stage_${s}`, from: a[a.length - 1].id, to: b[0].id });
  }
  return edges;
}

/** =========================
 *  Fallback semantic builder
 * ========================= */
function buildSemanticFallback(args: { prompt: string; detail?: number; stageCount: number }): SemanticBlueprint {
  const raw = (args.prompt || "").trim();
  const stageCount = clampNumber(args.stageCount, 2, 6);

  const title = pickTitleFromText(raw) || "Pipeline Diagram";
  const stages = Array.from({ length: stageCount }, (_, i) => ({ id: `s${i + 1}`, title: `Stage ${i + 1}` }));

  // 아주 단순: "A -> B -> C"면 그걸 stage에 분배
  const steps = parseSteps(raw);
  const nodes: SemanticBlueprint["nodes"] = [];
  let idn = 1;

  if (steps.length >= 2) {
    const use = steps.slice(0, stageCount);
    for (let i = 0; i < stageCount; i++) {
      const label = use[i] || `Stage ${i + 1}`;
      nodes.push({
        id: `n${idn++}`,
        stageId: `s${i + 1}`,
        kind: i === 0 ? "data" : i === stageCount - 1 ? "output" : "process",
        label: truncate(label, 28),
        order: 1,
      });
    }
  } else {
    // default
    for (let i = 0; i < stageCount; i++) {
      nodes.push({
        id: `n${idn++}`,
        stageId: `s${i + 1}`,
        kind: i === 0 ? "data" : i === stageCount - 1 ? "output" : "process",
        label: i === 0 ? "Input" : i === stageCount - 1 ? "Output" : `Process ${i}`,
        order: 1,
      });
    }
  }

  const edges = autoEdgesByStageOrder(nodes, stageCount);
  return { title, stageCount, stages, nodes, edges };
}

/** =========================
 *  Deterministic layout (PPT style)
 * ========================= */
function buildLayoutBlueprint(sem: SemanticBlueprint, opts: { stylePreset: string; layout: string; detail: number }): Blueprint {
  const isPpt = isPptPreset(opts.stylePreset);

  const W = 1400;
  const paddingX = 48;
  const paddingTop = 92;
  const paddingBottom = 48;
  const stageGap = 22;

  const stageCount = sem.stageCount;
  const stageW = Math.floor((W - paddingX * 2 - stageGap * (stageCount - 1)) / stageCount);

  // ✅ PPT 파스텔 톤(연함) + 헤더도 연함 + 텍스트는 진하게
  const stageTheme = [
    { header: "#DBEAFE", tint: "#EFF6FF" }, // blue
    { header: "#FFEDD5", tint: "#FFF7ED" }, // orange
    { header: "#DCFCE7", tint: "#F0FDF4" }, // green
    { header: "#EDE9FE", tint: "#F5F3FF" }, // purple
    { header: "#FFE4E6", tint: "#FFF1F2" }, // rose
    { header: "#E0F2FE", tint: "#F0F9FF" }, // sky
  ];

  const pastelNodes = ["#FFFFFF", "#FFFFFF", "#FFFFFF"]; // 노드는 거의 흰색 + 연회색 테두리 = PPT 느낌

  const style = {
    font_family: "Arial",
    font_size: 16,
    stroke: isPpt ? "#CBD5E1" : "#E5E7EB",
    stroke_width: isPpt ? 1 : 1.5,
  };

  const byStage: Record<string, SemanticBlueprint["nodes"]> = {};
  for (let i = 1; i <= stageCount; i++) byStage[`s${i}`] = [];
  for (const n of sem.nodes) byStage[n.stageId].push(n);
  for (const k of Object.keys(byStage)) byStage[k].sort((a, b) => a.order - b.order);

  const boxPaddingX = 14;
  const boxPaddingY = 14;
  const boxGapY = 12;
  const headerBarH = 40;
  const stageInnerPad = 14;

  const nodeW = stageW - stageInnerPad * 2;

  const elements: Blueprint["elements"] = [];
  const stageX: Record<string, number> = {};
  for (let i = 0; i < stageCount; i++) {
    stageX[`s${i + 1}`] = paddingX + i * (stageW + stageGap);
  }

  const stageHeights: Record<string, number> = {};
  let maxBottom = paddingTop;

  // nodes
  for (let s = 1; s <= stageCount; s++) {
    const sid = `s${s}`;
    const nodes = byStage[sid] || [];
    const sx = stageX[sid];

    let cursorY = paddingTop + headerBarH + stageInnerPad;

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const label = (n.label || "").trim();
      const sub = (n.sublabel || "").trim();

      const maxTextW = nodeW - boxPaddingX * 2;
      const labelLines = wrapTwoLinesByWidth(label, style.font_size, maxTextW);
      const subLines = sub ? wrapTwoLinesByWidth(sub, 13, maxTextW) : [];

      const linesCount = labelLines.length + subLines.length;
      const baseH = 66;
      const textBlockH = Math.max(1, linesCount) * Math.round(style.font_size * 1.25) + (subLines.length ? 6 : 0);
      const nodeH = Math.max(baseH, boxPaddingY * 2 + textBlockH);

      elements.push({
        id: sanitizeId(n.id),
        type: "box",
        x: sx + stageInnerPad,
        y: cursorY,
        w: nodeW,
        h: nodeH,
        fill: pastelNodes[0],
        stroke: "#CBD5E1",
        label_lines: [...labelLines, ...(subLines.length ? subLines.map((t) => `(${t})`) : [])],
        meta: { kind: n.kind, stageId: sid },
      });

      cursorY += nodeH + boxGapY;
    }

    const bottom = cursorY + stageInnerPad;
    stageHeights[sid] = bottom - paddingTop;
    maxBottom = Math.max(maxBottom, bottom);
  }

  const H = Math.max(780, Math.ceil(maxBottom + paddingBottom));

  // stage panels + headers (뒤에 깔려야 하니 unshift)
  for (let s = stageCount; s >= 1; s--) {
    const sid = `s${s}`;
    const sx = stageX[sid];
    const panelY = paddingTop;
    const panelH = Math.max(140, (stageHeights[sid] || 160) + 18);
    const theme = stageTheme[(s - 1) % stageTheme.length];

    elements.unshift({
      id: `stagePanel_${sid}`,
      type: "stagePanel",
      x: sx,
      y: panelY,
      w: stageW,
      h: panelH,
      fill: theme.tint,
      stroke: "#E2E8F0",
      label_lines: [],
      meta: { stageId: sid },
    });

    const headerTitle = sem.stages.find((x) => x.id === sid)?.title || sid;
    elements.unshift({
      id: `stageHeader_${sid}`,
      type: "stageHeader",
      x: sx,
      y: panelY,
      w: stageW,
      h: headerBarH,
      fill: theme.header,
      stroke: "#E2E8F0",
      label_lines: [headerTitle],
      meta: { stageId: sid },
    });
  }

  const connectors: Blueprint["connectors"] = (sem.edges ?? []).map((e, i) => ({
    id: sanitizeId(e.id || `e${i + 1}`),
    from: sanitizeId(e.from),
    to: sanitizeId(e.to),
    type: "elbow",
    label: e.label ? truncate(e.label, 18) : "",
  }));

  return {
    meta: { title: sem.title, notes: "" },
    canvas: { width: W, height: H, aspect_ratio: "auto" },
    style,
    elements,
    connectors,
  };
}

/** =========================
 *  SVG renderer (PPT-friendly)
 * ========================= */
function renderSvgFromBlueprint(bp: Blueprint, stylePreset: string) {
  const W = bp.canvas.width;
  const H = bp.canvas.height;

  const isPpt = isPptPreset(stylePreset);

  const font = bp.style?.font_family ?? "Arial";
  const fontSize = bp.style?.font_size ?? 16;

  const bg = rect(0, 0, W, H, 0, isPpt ? "#FFFFFF" : "#0B1020", "none", 0);

  const title = (bp.meta?.title ?? "").trim();
  const titleMaxW = W - 96;
  const titleFont = autoFitFontSingleLine(title, 28, 18, titleMaxW);
  const titleText = truncateByWidth(title, titleFont, titleMaxW);
  const titleSvg = `
    <g id="title">
      ${text(48, 56, titleText, font, titleFont, "#111827", 800)}
    </g>
  `.trim();

  const nodeMap = new Map<string, Blueprint["elements"][number]>();
  for (const el of bp.elements) nodeMap.set(el.id, el);

  const edgesSvg = (bp.connectors ?? [])
    .map((c) => renderConnector(c, nodeMap))
    .join("\n");

  const nodesSvg = bp.elements.map((el) => renderElement(el, font, fontSize)).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <g id="canvas">
    ${bg}
    ${titleSvg}
    <g id="edges">${edgesSvg}</g>
    <g id="elements">${nodesSvg}</g>
  </g>
</svg>`;
}

function renderElement(el: Blueprint["elements"][number], font: string, fontSize: number) {
  const gid = `el_${sanitizeId(el.id)}`;
  const fill = el.fill?.trim() ? el.fill : "#FFFFFF";
  const stroke = el.stroke?.trim() ? el.stroke : "#CBD5E1";

  // ✅ PPT 각진 느낌: rx를 작게
  const RX_PANEL = 8;
  const RX_NODE = 8;

  if (el.type === "stageHeader") {
    const label = (el.label_lines?.[0] || "").trim();
    const maxW = el.w - 20;
    const fs = autoFitFontSingleLine(label, 15, 11, maxW);
    const t = truncateByWidth(label, fs, maxW);
    return `
      <g id="${gid}">
        ${rect(el.x, el.y, el.w, el.h, RX_PANEL, fill, stroke, 1)}
        ${text(el.x + 12, el.y + 26, t, font, fs, "#111827", 800)}
      </g>
    `.trim();
  }

  if (el.type === "stagePanel") {
    return `
      <g id="${gid}">
        ${rect(el.x, el.y, el.w, el.h, RX_PANEL, fill, stroke, 1)}
      </g>
    `.trim();
  }

  // node
  const box = rect(el.x, el.y, el.w, el.h, RX_NODE, fill, stroke, 1);

  const lines = normalizeLabelLines(el.label_lines).slice(0, 4);
  const paddingX = 14;
  const paddingTop = 26;
  const lineGap = Math.round(fontSize * 1.25);
  const startY = el.y + paddingTop;

  const maxTextW = el.w - paddingX * 2;
  const safeLines = lines.map((ln) => truncateByWidth(ln, fontSize, maxTextW));

  const labelSvg = safeLines
    .map((ln, i) => text(el.x + paddingX, startY + i * lineGap, ln, font, fontSize, "#111827", i === 0 ? 800 : 500))
    .join("\n");

  return `
    <g id="${gid}">
      ${box}
      <g id="${gid}_label">${labelSvg}</g>
    </g>
  `.trim();
}

function renderConnector(
  c: Blueprint["connectors"][number],
  nodeMap: Map<string, Blueprint["elements"][number]>
) {
  const from = nodeMap.get(c.from);
  const to = nodeMap.get(c.to);
  if (!from || !to) return "";

  const gid = `edge_${sanitizeId(c.id)}`;

  const a = pickAnchor(from, to);
  const b = pickAnchor(to, from);
  const x1 = a.x, y1 = a.y;
  const x2 = b.x, y2 = b.y;

  const midX = Math.round((x1 + x2) / 2);
  const pathD = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;

  // ✅ PPT 느낌: 회색 선
  const stroke = "#334155"; // slate-700
  const line = `<path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="2" stroke-opacity="0.85"/>`;
  const head = arrowHeadPolygonForPath(pathD, 12, 8, stroke);

  return `
    <g id="${gid}">
      ${line}
      ${head}
    </g>
  `.trim();
}

/** =========================
 *  Helpers
 * ========================= */
function detectStageCount(prompt: string) {
  const t = (prompt || "").toLowerCase();
  // "3-stage", "3 stages", "3스테이지", "3 stage"...
  const m = t.match(/(\d)\s*[- ]*\s*(stage|stages|스테이지)/);
  if (m && m[1]) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return clampNumber(n, 2, 6);
  }
  // "A -> B -> C" 형태면 개수로 추정
  const steps = parseSteps(prompt);
  if (steps.length >= 2 && steps.length <= 6) return steps.length;
  return 4; // 기본
}

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(s.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function stripCodeFences(s: string) {
  const t = s.trim();
  if (t.startsWith("```")) {
    return t.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return t;
}

function isPptPreset(preset: string) {
  const p = (preset || "").toLowerCase();
  return p === "ppt" || p === "light" || p === "clean";
}

function pickAnchor(a: Blueprint["elements"][number], b: Blueprint["elements"][number]) {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;

  const dx = bx - ax;
  const dy = by - ay;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { x: Math.round(a.x + a.w), y: Math.round(ay) } : { x: Math.round(a.x), y: Math.round(ay) };
  } else {
    return dy >= 0 ? { x: Math.round(ax), y: Math.round(a.y + a.h) } : { x: Math.round(ax), y: Math.round(a.y) };
  }
}

function arrowHeadPolygonForPath(pathD: string, len: number, width: number, color: string) {
  const nums = pathD
    .replace(/[ML]/g, " ")
    .trim()
    .split(/\s+/)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  if (nums.length < 4) return "";

  const x2 = nums[nums.length - 2];
  const y2 = nums[nums.length - 1];
  const x1 = nums[nums.length - 4];
  const y1 = nums[nums.length - 3];

  return arrowHeadPolygon(x1, y1, x2, y2, len, width, color);
}

function arrowHeadPolygon(x1: number, y1: number, x2: number, y2: number, len: number, width: number, color: string) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  const px = x2;
  const py = y2;

  const bx = px - ux * len;
  const by = py - uy * len;

  const vx = -uy;
  const vy = ux;

  const leftX = bx + vx * (width / 2);
  const leftY = by + vy * (width / 2);
  const rightX = bx - vx * (width / 2);
  const rightY = by - vy * (width / 2);

  return `<polygon points="${Math.round(px)},${Math.round(py)} ${Math.round(leftX)},${Math.round(leftY)} ${Math.round(rightX)},${Math.round(rightY)}" fill="${color}"/>`;
}

function rect(x: number, y: number, w: number, h: number, rx: number, fill: string, stroke: string, strokeWidth: number) {
  return `<rect x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(w)}" height="${Math.round(h)}" rx="${Math.round(rx)}"
    fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
}

function text(x: number, y: number, content: string, fontFamily: string, fontSize: number, fill: string, fontWeight: number) {
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

function clampNumber(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function normalizeLabelLines(lines?: string[]) {
  const raw = Array.isArray(lines) ? lines : [];
  const flat = raw.flatMap((l) => (l ?? "").split("\n")).map((s) => s.trim()).filter(Boolean);
  return flat.length ? flat : ["(untitled)"];
}

/** text width approx */
function approxTextWidthPx(text: string, fontSize: number) {
  return (text?.length || 0) * fontSize * 0.55;
}

function autoFitFontSingleLine(text: string, maxFont: number, minFont: number, maxWidthPx: number) {
  const t = (text || "").trim();
  if (!t) return minFont;
  for (let fs = maxFont; fs >= minFont; fs--) {
    if (approxTextWidthPx(t, fs) <= maxWidthPx) return fs;
  }
  return minFont;
}

function truncateByWidth(text: string, fontSize: number, maxWidthPx: number) {
  const t = (text || "").trim();
  if (!t) return "";
  if (approxTextWidthPx(t, fontSize) <= maxWidthPx) return t;

  let lo = 0;
  let hi = t.length;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const cand = t.slice(0, mid) + "…";
    if (approxTextWidthPx(cand, fontSize) <= maxWidthPx) lo = mid;
    else hi = mid;
  }
  return t.slice(0, Math.max(1, lo)) + "…";
}

function wrapTwoLinesByWidth(text: string, fontSize: number, maxWidthPx: number) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return [""];

  if (approxTextWidthPx(t, fontSize) <= maxWidthPx) return [t];

  const words = t.split(" ");
  const lines: string[] = [];
  let cur = "";

  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (approxTextWidthPx(next, fontSize) <= maxWidthPx) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= 2) break;
    }
  }
  if (lines.length < 2 && cur) lines.push(cur);

  lines[0] = truncateByWidth(lines[0], fontSize, maxWidthPx);
  if (lines[1]) lines[1] = truncateByWidth(lines[1], fontSize, maxWidthPx);

  const joined = lines.join(" ");
  if (joined.length < t.length) {
    const idx = Math.min(1, lines.length - 1);
    const last = lines[idx] || "";
    if (!last.endsWith("…")) lines[idx] = truncateByWidth(last + "…", fontSize, maxWidthPx);
  }

  return lines.filter((x) => x.trim().length > 0);
}

/** parseSteps */
function parseSteps(prompt: string): string[] {
  if (!prompt) return [];

  if (prompt.includes("->") || prompt.includes("→")) {
    const arrow = prompt.includes("->") ? "->" : "→";
    const parts = prompt.split(arrow).map((s) => s.trim()).filter(Boolean);
    return normalizeLabels(parts);
  }

  const lines = prompt.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  return normalizeLabels(lines);
}

function normalizeLabels(labels: string[]) {
  return labels
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((s) => (s.length > 80 ? s.slice(0, 80) + "…" : s));
}

function pickTitleFromText(text: string) {
  const t = (text || "").trim();
  if (!t) return "";
  const firstLine = t.split(/\r?\n/)[0]?.trim() || "";
  if (firstLine.length >= 8 && firstLine.length <= 120) return firstLine;
  return "";
}
