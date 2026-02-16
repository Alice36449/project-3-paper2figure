// app/api/convert/route.ts
/**
 * paper2figure — Next.js(App Router) API route
 *
 * ✅ 목표(안정성):
 * 1) (가능하면) OpenAI로 "semantic blueprint"만 생성 (좌표/픽셀 배치 금지)
 * 2) OpenAI 실패/키없음이면 로컬 규칙 기반 semantic fallback
 * 3) ppt/light 프리셋은 "흰 배경 + 얇은 테두리 + 파스텔 박스" 강제
 * 4) 텍스트 잘림/캔버스 밖 문제는 "렌더러/레이아웃 엔진"에서 해결 (LLM에게 맡기지 않음)
 * 5) connector 화살표는 marker 금지 → polygon 화살촉
 * 6) PowerPoint 편집 친화: <g id="..."> 그룹화 + <text> 유지 (path 변환 금지)
 *
 * 🔒 보안:
 * - API 키는 절대 하드코딩 금지
 * - .env.local 에만 저장: OPENAI_API_KEY=...
 * - .gitignore 에 .env.local 포함 확인(Next 기본 포함이지만 꼭 확인)
 *
 * 권장 모델(semantic-only 생성 기준):
 * - 1순위: gpt-4.1-mini (가격/품질 균형)
 * - 2순위: gpt-4.1 (복잡/긴 논문 텍스트에서 안정성↑)
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** =========================
 *  1) "최종 렌더용" Blueprint (픽셀 좌표 포함)
 * ========================= */
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
    type: string; // box | pill | stagePanel | stageHeader | ...
    x: number;
    y: number;
    w: number;
    h: number;
    fill?: string;
    stroke?: string;
    label_lines?: string[];
    // 선택 확장
    meta?: Record<string, any>;
  }>;
  connectors: Array<{
    id: string;
    from: string;
    to: string;
    type?: string; // straight | elbow
    anchor?: string; // auto | left/right/top/bottom
    label?: string;
  }>;
};

/** =========================
 *  2) OpenAI가 생성해야 하는 "semantic blueprint" (좌표 없음!)
 * ========================= */
type SemanticStageId = "s1" | "s2" | "s3" | "s4";

type SemanticBlueprint = {
  title: string;
  // 4-stage 템플릿 고정(정확도/일관성)
  stages: Array<{
    id: SemanticStageId;
    title: string;
  }>;
  nodes: Array<{
    id: string;
    stageId: SemanticStageId;
    kind: "data" | "process" | "model" | "function" | "output" | "note";
    label: string;
    sublabel?: string;
    // stage 내부 세로 정렬 순서 (1..n)
    order: number;
  }>;
  edges: Array<{
    id: string;
    from: string;
    to: string;
    label?: string;
  }>;
};

/** =========================
 *  3) OpenAI system prompt (semantic-only)
 * ========================= */
const SEMANTIC_SYSTEM_PROMPT = `
You generate a "semantic blueprint" for an academic PowerPoint-style diagram.
Return ONLY valid JSON. No markdown, no code fences, no explanation.

Hard rules:
- DO NOT include any pixel coordinates (x,y,w,h) or canvas sizes.
- Use the fixed 4 stages, with ids: "s1","s2","s3","s4".
- Provide nodes with: id, stageId, kind, label, optional sublabel, and integer order (top-to-bottom).
- Provide edges with: id, from, to, optional label.
- Keep labels short. Avoid paragraphs.
- Prefer a left-to-right pipeline conceptually.

JSON schema (informal):
{
  "title": string,
  "stages": [{"id":"s1"|"s2"|"s3"|"s4","title":string}, ...],
  "nodes": [{"id":string,"stageId":"s1"|"s2"|"s3"|"s4","kind":"data"|"process"|"model"|"function"|"output"|"note","label":string,"sublabel"?:string,"order":number}, ...],
  "edges": [{"id":string,"from":string,"to":string,"label"?:string}, ...]
}
`.trim();

/** =========================
 *  4) POST handler
 * ========================= */
export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const prompt = typeof form.get("prompt") === "string" ? String(form.get("prompt")) : "";
    const stylePresetRaw = typeof form.get("stylePreset") === "string" ? String(form.get("stylePreset")) : "ppt";
    const stylePreset = stylePresetRaw.trim().toLowerCase(); // ✅ 공백/대소문자 방지

    const layoutRaw = typeof form.get("layout") === "string" ? String(form.get("layout")) : "auto";
    const layout = layoutRaw.trim().toLowerCase();


    const detailRaw = typeof form.get("detail") === "string" ? String(form.get("detail")) : "70";
    const detail = clampNumber(Number(detailRaw) || 70, 0, 100);

    // 1) (가능하면) OpenAI로 semantic blueprint 생성
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini"; // ← 기본값 추천(semantic-only에 충분)

    let semantic: SemanticBlueprint | null = null;

    if (apiKey) {
      semantic = await generateSemanticWithOpenAI({
        apiKey,
        model,
        prompt,
        stylePreset,
        layout,
        detail,
      });
    }

    // 2) 실패/키없음 fallback(semantic-only)
    if (!semantic) {
      semantic = buildSemanticFallback({ prompt, detail, stylePreset, layout });
    }

    // 3) deterministic layout → 최종 Blueprint(x,y,w,h 포함)
    const bp = buildLayoutBlueprint(semantic, {
      stylePreset,
      layout,
      detail,
    });

    // 4) SVG 생성 (PPT-friendly)
    const svg = renderSvgFromBlueprint(bp, stylePreset);

    return new NextResponse(svg, {
        status: 200,
        headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "x-debug-stylepreset": stylePreset,
        },
    });

  } catch (e: any) {
    return new NextResponse(e?.message || "Server error", { status: 500 });
  }
}

/** =========================
 *  5) OpenAI: semantic JSON 생성
 * ========================= */
async function generateSemanticWithOpenAI(args: {
  apiKey: string;
  model: string;
  prompt: string;
  stylePreset: string;
  layout: string;
  detail: number;
}): Promise<SemanticBlueprint | null> {
  try {
    const client = new OpenAI({ apiKey: args.apiKey });

    const userMsg = `
User prompt:
${args.prompt || "(empty)"}

UI options:
- stylePreset: ${args.stylePreset}
- layout: ${args.layout}
- detail: ${args.detail}

Make a clean 4-stage pipeline. Keep node labels short.
Return ONLY JSON.
`.trim();

    // NOTE: 일부 환경에서 responses API가 더 안정적이지만,
    // 여기서는 호환성을 위해 chat.completions 유지.
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

    const normalized = normalizeSemantic(parsed);
    return normalized;
  } catch {
    return null;
  }
}

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    // 가끔 앞뒤에 잡다한 텍스트가 섞이면 JSON만 추출 시도
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

/** semantic validation/normalization (가볍게) */
function normalizeSemantic(raw: any): SemanticBlueprint | null {
  if (!raw || typeof raw !== "object") return null;

  const title = typeof raw.title === "string" ? raw.title.trim() : "Untitled Diagram";

  const stages = Array.isArray(raw.stages) ? raw.stages : [];
  const stageIds = new Set(["s1", "s2", "s3", "s4"]);
  const fixedStages: SemanticBlueprint["stages"] = [
    { id: "s1", title: "Inputs & Initial Proposals" },
    { id: "s2", title: "Filtering / Re-weighting" },
    { id: "s3", title: "Segmentation & Selection" },
    { id: "s4", title: "Output & Evaluation" },
  ];

  // stage title이 제공되면 덮어쓰기
  for (const st of stages) {
    if (st && stageIds.has(st.id) && typeof st.title === "string") {
      const idx = fixedStages.findIndex((x) => x.id === st.id);
      if (idx >= 0) fixedStages[idx] = { id: st.id, title: st.title.trim() || fixedStages[idx].title };
    }
  }

  const nodesRaw = Array.isArray(raw.nodes) ? raw.nodes : [];
  const nodes: SemanticBlueprint["nodes"] = [];

  for (const n of nodesRaw) {
    if (!n || typeof n !== "object") continue;
    const id = typeof n.id === "string" ? n.id.trim() : "";
    const stageId = typeof n.stageId === "string" ? (n.stageId.trim() as SemanticStageId) : "s1";
    const kind = typeof n.kind === "string" ? n.kind.trim() : "process";
    const label = typeof n.label === "string" ? n.label.trim() : "";
    const sublabel = typeof n.sublabel === "string" ? n.sublabel.trim() : undefined;
    const order = Number.isFinite(n.order) ? Math.max(1, Math.floor(n.order)) : 1;

    if (!id || !stageIds.has(stageId) || !label) continue;
    if (!["data", "process", "model", "function", "output", "note"].includes(kind)) continue;

    nodes.push({
      id: sanitizeId(id),
      stageId,
      kind: kind as any,
      label: label,
      sublabel,
      order,
    });
  }

  // 노드가 너무 없으면 기본 3개라도 생성
  if (nodes.length < 3) {
    const fallback = buildSemanticFallback({ prompt: title, detail: 70, stylePreset: "ppt", layout: "auto" });
    return fallback;
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
    if (!id || !from || !to) continue;
    if (!nodeIdSet.has(from) || !nodeIdSet.has(to)) continue;
    edges.push({ id, from, to, label });
  }

  // edge가 아예 없으면 stage별 순서로 자동 연결
  const edgesFinal = edges.length ? edges : autoEdgesByStageOrder(nodes);

  return { title, stages: fixedStages, nodes, edges: edgesFinal };
}

function autoEdgesByStageOrder(nodes: SemanticBlueprint["nodes"]): SemanticBlueprint["edges"] {
  const byStage: Record<string, SemanticBlueprint["nodes"]> = {
    s1: [],
    s2: [],
    s3: [],
    s4: [],
  };
  for (const n of nodes) byStage[n.stageId].push(n);
  for (const k of Object.keys(byStage)) byStage[k].sort((a, b) => a.order - b.order);

  const edges: SemanticBlueprint["edges"] = [];
  const stageOrder: SemanticStageId[] = ["s1", "s2", "s3", "s4"];

  // stage 내부 연결
  for (const sid of stageOrder) {
    const arr = byStage[sid];
    for (let i = 0; i < arr.length - 1; i++) {
      edges.push({ id: `e_${sid}_${i + 1}`, from: arr[i].id, to: arr[i + 1].id });
    }
  }
  // stage 간 연결(마지막→다음 stage 첫번째)
  for (let i = 0; i < stageOrder.length - 1; i++) {
    const a = byStage[stageOrder[i]];
    const b = byStage[stageOrder[i + 1]];
    if (a.length && b.length) edges.push({ id: `e_stage_${i + 1}`, from: a[a.length - 1].id, to: b[0].id });
  }
  return edges;
}

/** =========================
 *  6) fallback semantic builder (로컬)
 *     - "논문 텍스트 붙여넣기"에서도 최소한 stage별 핵심 노드만 뽑아줌
 * ========================= */
type BuildSemanticArgs = {
  prompt: string;
  stylePreset?: string;
  detail?: number;
  layout?: string;
};

function buildSemanticFallback(args: BuildSemanticArgs): SemanticBlueprint {
  const raw = (args.prompt || "").trim();

  // 아주 단순 추출: 줄/불릿/화살표 기반으로 키워드만 뽑아서 stage에 분배
  const parts = parseSteps(raw);
  const title = pickTitleFromText(raw) || "Pipeline Diagram";

  const stages: SemanticBlueprint["stages"] = [
    { id: "s1", title: "Inputs & Initial Proposals" },
    { id: "s2", title: "Filtering / Re-weighting" },
    { id: "s3", title: "Segmentation & Selection" },
    { id: "s4", title: "Output & Evaluation" },
  ];

  // stage별 기본 노드 템플릿
  const defaults = [
    // s1
    [
      { kind: "data" as const, label: "Query Image", sublabel: "N-shot target" },
      { kind: "data" as const, label: "Support Set", sublabel: "K-shot + masks" },
      { kind: "data" as const, label: "Text Prompt", sublabel: "class name" },
      { kind: "model" as const, label: "Detector", sublabel: "open-vocab" },
    ],
    // s2
    [
      { kind: "process" as const, label: "Crop & Encode", sublabel: "per box" },
      { kind: "function" as const, label: "Similarity Fusion", sublabel: "score re-weight" },
      { kind: "function" as const, label: "Threshold Filter", sublabel: "keep top boxes" },
    ],
    // s3
    [
      { kind: "model" as const, label: "SAM Refinement", sublabel: "iterative loop" },
      { kind: "data" as const, label: "Candidate Masks", sublabel: "post-refine" },
      { kind: "function" as const, label: "Final Selection", sublabel: "feature sim" },
    ],
    // s4
    [
      { kind: "process" as const, label: "Mask Union", sublabel: "aggregation" },
      { kind: "output" as const, label: "Final Mask", sublabel: "prediction" },
      { kind: "function" as const, label: "IoU / mIoU", sublabel: "evaluation" },
    ],
  ];

  // parts에서 의미 있는 키워드를 최대 6개 정도 가져와 stage2/3에 섞어줌
  const extra = parts.slice(0, 6).map((t) => t.replace(/\n/g, " ").trim()).filter(Boolean);

  const nodes: SemanticBlueprint["nodes"] = [];
  let idx = 1;

  for (let s = 0; s < 4; s++) {
    const sid = (["s1", "s2", "s3", "s4"][s] as SemanticStageId);
    const base = defaults[s];
    for (let i = 0; i < base.length; i++) {
      nodes.push({
        id: `n${idx++}`,
        stageId: sid,
        kind: base[i].kind,
        label: base[i].label,
        sublabel: base[i].sublabel,
        order: i + 1,
      });
    }

    // stage2/3에만 extra 일부 추가
    if ((sid === "s2" || sid === "s3") && extra.length) {
      const addCount = sid === "s2" ? Math.min(2, extra.length) : Math.min(2, extra.length - 2);
      const start = sid === "s2" ? 0 : Math.min(2, extra.length);
      for (let k = 0; k < addCount; k++) {
        const label = extra[start + k];
        nodes.push({
          id: `n${idx++}`,
          stageId: sid,
          kind: "note",
          label: label.length > 24 ? label.slice(0, 24) + "…" : label,
          sublabel: "from text",
          order: base.length + k + 1,
        });
      }
    }
  }

  const edges = autoEdgesByStageOrder(nodes);
  return { title, stages, nodes, edges };
}

/** =========================
 *  7) Deterministic layout → Blueprint(x,y,w,h)
 *     - 핵심: "4단 컬럼 템플릿"으로 항상 PPT같이 나오게 강제
 * ========================= */
function buildLayoutBlueprint(sem: SemanticBlueprint, opts: { stylePreset: string; layout: string; detail: number }): Blueprint {
  const isLight = isLightPreset(opts.stylePreset);

  // 캔버스: 기본 1400x800 (PPT에 적당), 내용 많으면 높이 자동 확장
  const W = 1400;
  const paddingX = 48;
  const paddingTop = 96; // 타이틀 공간
  const paddingBottom = 48;
  const stageGap = 22;

  const stageCount = 4;
  const stageW = Math.floor((W - paddingX * 2 - stageGap * (stageCount - 1)) / stageCount);

  // stage별 theme 컬러(헤더바) + panel background tint
  const stageTheme = {
    s1: { header: "#2F6FB3", tint: "#EEF5FF" }, // blue
    s2: { header: "#D98A2B", tint: "#FFF6EA" }, // orange
    s3: { header: "#3B8C4A", tint: "#EEF8F0" }, // green
    s4: { header: "#6B57B8", tint: "#F3F0FF" }, // purple
  } as const;

  // 박스 파스텔(노드용) — ppt 느낌
  const pastel = ["#E8F0FE", "#E8F5E9", "#FFF3E0", "#E3F2FD", "#F3E5F5", "#FCE7F3", "#D1FAE5", "#FEF3C7"];

  // 글꼴/선
  const style = {
    font_family: "Arial",
    font_size: 16,
    stroke: isLight ? "#111827" : "#E5E7EB",
    stroke_width: isLight ? 1.5 : 2,
    fills: {
      primary: isLight ? "#F8FAFC" : "#101A36",
      secondary: isLight ? "#FFFFFF" : "#0B1020",
      highlight: isLight ? "#111827" : "#22D3EE",
    },
  };

  // stage별 노드 수집 + order 정렬
  const byStage: Record<SemanticStageId, SemanticBlueprint["nodes"]> = { s1: [], s2: [], s3: [], s4: [] };
  for (const n of sem.nodes) byStage[n.stageId].push(n);
  (Object.keys(byStage) as SemanticStageId[]).forEach((sid) => byStage[sid].sort((a, b) => a.order - b.order));

  // 노드 박스 높이(텍스트 길이에 따라 가변)
  const boxPaddingX = 14;
  const boxPaddingY = 14;
  const boxGapY = 12;
  const headerBarH = 40;
  const stageInnerPad = 14;

  // 노드 폭은 stageW에서 내부 패딩 제외
  const nodeW = stageW - stageInnerPad * 2;

  // elements 생성
  const elements: Blueprint["elements"] = [];

  // stage 패널(배경) + 헤더 바
  // stage 패널의 실제 높이는 "노드 배치 후" 계산해야 하므로 일단 임시로 넣고 나중에 업데이트한다.
  const stagePanelIds: Record<SemanticStageId, string> = { s1: "stage_s1", s2: "stage_s2", s3: "stage_s3", s4: "stage_s4" };

  // stage별 x 위치
  const stageX: Record<SemanticStageId, number> = {
    s1: paddingX + 0 * (stageW + stageGap),
    s2: paddingX + 1 * (stageW + stageGap),
    s3: paddingX + 2 * (stageW + stageGap),
    s4: paddingX + 3 * (stageW + stageGap),
  };

  // stage 내부 배치 결과를 기록하여 panel 높이 산정
  const stageHeights: Record<SemanticStageId, number> = { s1: 0, s2: 0, s3: 0, s4: 0 };

  // 먼저 노드들을 각 stage에 배치
  let maxStageBottom = paddingTop;

  for (const sid of ["s1", "s2", "s3", "s4"] as SemanticStageId[]) {
    const nodes = byStage[sid];

    let cursorY = paddingTop + headerBarH + stageInnerPad;
    const sx = stageX[sid];

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];

      // label/sublabel을 "렌더러가 처리"할 수 있도록 여기서 미리 2줄 wrap + ellipsis만 걸어둠
      const label = (n.label || "").trim();
      const sub = (n.sublabel || "").trim();

      // max text width는 nodeW - padding
      const maxTextW = nodeW - boxPaddingX * 2;
      const labelLines = wrapTwoLinesByWidth(label, style.font_size, maxTextW);
      const subLines = sub ? wrapTwoLinesByWidth(sub, 13, maxTextW) : [];

      // 박스 높이 계산(최소 높이 보장)
      const linesCount = labelLines.length + subLines.length;
      const baseH = 64;
      const textBlockH = Math.max(1, linesCount) * Math.round(style.font_size * 1.25) + (subLines.length ? 6 : 0);
      const nodeH = Math.max(baseH, boxPaddingY * 2 + textBlockH);

      // kind별 미세 스타일
      const fill = pastel[(i + (sid === "s2" ? 1 : sid === "s3" ? 2 : sid === "s4" ? 3 : 0)) % pastel.length];

      elements.push({
        id: sanitizeId(n.id),
        type: n.kind === "note" ? "pill" : "box",
        x: sx + stageInnerPad,
        y: cursorY,
        w: nodeW,
        h: nodeH,
        fill: isLight ? fill : style.fills.primary,
        stroke: isLight ? "#CBD5E1" : style.stroke,
        label_lines: [
          ...labelLines,
          ...(subLines.length ? subLines.map((t) => `(${t})`) : []),
        ],
        meta: { kind: n.kind, stageId: sid },
      });

      cursorY += nodeH + boxGapY;
    }

    const bottom = cursorY + stageInnerPad;
    stageHeights[sid] = bottom - paddingTop;
    maxStageBottom = Math.max(maxStageBottom, bottom);
  }

  // 캔버스 높이: 내용이 많으면 자동 확장(잘림 방지)
  const H = Math.max(820, Math.ceil(maxStageBottom + paddingBottom));

  // stage panel + header elements를 앞에 추가(노드보다 뒤로)
  for (const sid of ["s1", "s2", "s3", "s4"] as SemanticStageId[]) {
    const sx = stageX[sid];
    const panelY = paddingTop;
    const panelH = Math.max(140, stageHeights[sid] + 18); // 약간 여유
    const theme = stageTheme[sid];

    // panel
    elements.unshift({
      id: stagePanelIds[sid],
      type: "stagePanel",
      x: sx,
      y: panelY,
      w: stageW,
      h: panelH,
      fill: isLight ? theme.tint : "rgba(255,255,255,0.05)",
      stroke: isLight ? "#E5E7EB" : "rgba(229,231,235,0.18)",
      label_lines: [],
      meta: { stageId: sid },
    });

    // header bar
    elements.unshift({
      id: `stageHeader_${sid}`,
      type: "stageHeader",
      x: sx,
      y: panelY,
      w: stageW,
      h: headerBarH,
      fill: isLight ? theme.header : "#111827",
      stroke: "none",
      label_lines: [sem.stages.find((x) => x.id === sid)?.title || sid],
      meta: { stageId: sid },
    });
  }

  // connectors: semantic edges 기반으로 생성
  const connectors: Blueprint["connectors"] = sem.edges.map((e, i) => ({
    id: sanitizeId(e.id || `e${i + 1}`),
    from: sanitizeId(e.from),
    to: sanitizeId(e.to),
    type: "elbow", // stage 간 교차를 위해 기본 elbow
    anchor: "auto",
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
 *  8) SVG Renderer (PPT-friendly)
 *     - 중요: marker 사용 금지 → polygon 화살촉
 *     - 중요: 모든 의미 단위 <g id="...">
 *     - 중요: <text> 유지
 * ========================= */
function renderSvgFromBlueprint(bp: Blueprint, stylePreset: string) {
  const W = bp.canvas.width;
  const H = bp.canvas.height;

  const isLight = isLightPreset(stylePreset);

  const style = {
    font: bp.style?.font_family ?? "Arial",
    fontSize: bp.style?.font_size ?? 16,
    stroke: isLight ? "#111827" : (bp.style?.stroke ?? "#E5E7EB"),
    strokeWidth: bp.style?.stroke_width ?? (isLight ? 1.5 : 2),
    fillPrimary: isLight ? "#F8FAFC" : (bp.style?.fills?.primary ?? "#101A36"),
    fillSecondary: isLight ? "#FFFFFF" : (bp.style?.fills?.secondary ?? "#0B1020"),
    highlight: isLight ? "#111827" : (bp.style?.fills?.highlight ?? "#22D3EE"),
  };

  const title = (bp.meta?.title ?? "").trim();

  // bg
  const bg = rect(0, 0, W, H, 0, style.fillSecondary, "none", 0);

  // title (자동 fit + truncate)
  const titleMaxW = W - 96;
  const titleFont = autoFitFontSingleLine(title, 28, 18, titleMaxW);
  const titleText = truncateByWidth(title, titleFont, titleMaxW);
  const titleSvg = `
    <g id="title">
      ${text(48, 56, titleText, style.font, titleFont, isLight ? "#111827" : "#E5E7EB", 700)}
    </g>
  `.trim();

  // map
  const nodeMap = new Map<string, Blueprint["elements"][number]>();
  for (const el of bp.elements) nodeMap.set(el.id, el);

  // edges 먼저 (뒤로)
  const edgesSvg = (bp.connectors ?? [])
    .map((c) => renderConnector(c, nodeMap, style, isLight))
    .join("\n");

  // nodes (앞으로)
  const nodesSvg = bp.elements.map((el) => renderElement(el, style, isLight)).join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <g id="canvas">
    ${bg}
    ${titleSvg}
    <g id="edges">${edgesSvg}</g>
    <g id="elements">${nodesSvg}</g>
  </g>
</svg>`;

  return svg;
}

function renderElement(
  el: Blueprint["elements"][number],
  style: { font: string; fontSize: number; stroke: string; strokeWidth: number; highlight: string; fillPrimary: string },
  isLightBg: boolean
) {
  const gid = `el_${sanitizeId(el.id)}`;

  const fill = el.fill && el.fill.trim() ? el.fill : style.fillPrimary;
  const stroke = el.stroke && el.stroke.trim() ? el.stroke : style.stroke;

  // type별 렌더 규칙
  if (el.type === "stageHeader") {
    const label = (el.label_lines?.[0] || "").trim();
    const maxW = el.w - 20;
    const fs = autoFitFontSingleLine(label, 16, 12, maxW);
    const t = truncateByWidth(label, fs, maxW);
    return `
      <g id="${gid}">
        ${rect(el.x, el.y, el.w, el.h, 10, fill, "none", 0)}
        ${text(el.x + 12, el.y + 26, t, style.font, fs, "#FFFFFF", 700)}
      </g>
    `.trim();
  }

  if (el.type === "stagePanel") {
    return `
      <g id="${gid}">
        ${rect(el.x, el.y, el.w, el.h, 14, fill, stroke, 1.2, 1)}
      </g>
    `.trim();
  }

  // 일반 노드(box/pill)
  const rx = el.type === "pill" ? Math.min(el.h / 2, 999) : 14;

  const box = rect(el.x, el.y, el.w, el.h, rx, fill, stroke, style.strokeWidth, 1);

  const textColor = isHexLight(fill) ? "#111827" : (isLightBg ? "#111827" : "#E5E7EB");

  // label_lines: 최대 3~4줄만 표시 (PPT 편집/가독성)
  const lines = normalizeLabelLines(el.label_lines).slice(0, 4);

  const paddingX = 14;
  const paddingTop = 26;
  const lineGap = Math.round(style.fontSize * 1.25);
  const startY = el.y + paddingTop;

  // 각 줄도 폭 기준으로 안전하게 잘라줌(잘림 방지)
  const maxTextW = el.w - paddingX * 2;
  const safeLines = lines.map((ln) => truncateByWidth(ln, style.fontSize, maxTextW));

  const label = safeLines
    .map((ln, i) => text(el.x + paddingX, startY + i * lineGap, ln, style.font, style.fontSize, textColor, i === 0 ? 700 : 400))
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

  // elbow 라우팅(가로→세로)로 stage간 연결 안정화
  const isElbow = (c.type || "elbow") === "elbow";
  let pathD = "";

  if (!isElbow) {
    pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
  } else {
    // 중간 꺾이는 점: 기본적으로 중간 x에서 꺾음
    const midX = Math.round((x1 + x2) / 2);
    pathD = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
  }

  const line = `<path d="${pathD}" fill="none" stroke="${style.highlight}" stroke-width="2" stroke-opacity="0.9"/>`;

  // 화살촉: 마지막 세그먼트 방향 추정
  const head = arrowHeadPolygonForPath(pathD, 12, 8, style.highlight);

  const label = (c.label ?? "").trim();
  const labelSvg = label
    ? (() => {
        // 라벨은 대충 중앙에 둠(정밀 배치는 PPT에서 직접 수정 가능)
        const mx = Math.round((x1 + x2) / 2);
        const my = Math.round((y1 + y2) / 2);
        const boxW = 82;
        const boxH = 22;
        const fill = isLightBg ? "#FFFFFF" : "#0B1020";
        const stroke = isLightBg ? "#E5E7EB" : "rgba(229,231,235,0.16)";
        const textColor = isLightBg ? "#111827" : "#E5E7EB";
        return `
          <g id="${gid}_label">
            <rect x="${mx - Math.floor(boxW / 2)}" y="${my - Math.floor(boxH / 2)}" width="${boxW}" height="${boxH}" rx="10"
              fill="${fill}" stroke="${stroke}" stroke-width="1"/>
            ${text(mx - Math.floor(boxW / 2) + 10, my + 5, truncate(label, 18), "Arial", 12, textColor, 600)}
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

/** =========================
 *  9) Geometry / helpers
 * ========================= */
function pickAnchor(a: Blueprint["elements"][number], b: Blueprint["elements"][number]) {
  // stagePanel/stageHeader는 연결 대상이 아니므로 방어
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
  // path 끝점과, 끝점 바로 이전 점을 추출하여 방향 벡터로 삼각형 생성
  // path는 "M x y L x y L x y ..." 형태로 생성됨
  const nums = pathD
    .replace(/[ML]/g, " ")
    .trim()
    .split(/\s+/)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));

  // nums는 [x1,y1,x2,y2,x3,y3,...]
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

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  strokeOpacity = 1
) {
  return `<rect x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(w)}" height="${Math.round(h)}" rx="${Math.round(rx)}"
    fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"/>`;
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
  const flat = raw
    .flatMap((l) => (l ?? "").split("\n"))
    .map((s) => s.trim())
    .filter(Boolean);
  return flat.length ? flat : ["(untitled)"];
}

function isLightPreset(preset: string) {
  const p = (preset || "").toLowerCase();
  return p === "ppt" || p === "light";
}

function isHexLight(hex: string) {
  const h = (hex || "").trim().toLowerCase();
  if (!h.startsWith("#") || (h.length !== 7 && h.length !== 4)) return true;

  const rgb = h.length === 4 ? [h[1] + h[1], h[2] + h[2], h[3] + h[3]] : [h.slice(1, 3), h.slice(3, 5), h.slice(5, 7)];
  const r = parseInt(rgb[0], 16);
  const g = parseInt(rgb[1], 16);
  const b = parseInt(rgb[2], 16);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum >= 170;
}

/** =========================
 *  10) Text fitting utilities (서버에서 근사 폭 측정)
 *      - PPT 편집 SVG에서는 "너무 길면 잘림"이 치명적이라 렌더러가 방지
 * ========================= */
function approxTextWidthPx(text: string, fontSize: number) {
  // Arial 기준 근사: 글자수 * fontSize * 0.55
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

  // 이분 탐색 대신 단순 감소(짧은 텍스트가 대부분)
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

  // 한 줄로 되면 끝
  if (approxTextWidthPx(t, fontSize) <= maxWidthPx) return [t];

  const words = t.split(" ");
  const lines: string[] = [];
  let cur = "";

  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (approxTextWidthPx(next, fontSize) <= maxWidthPx) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= 2) break;
    }
  }
  if (lines.length < 2 && cur) lines.push(cur);

  // 2줄 넘어가면 마지막 줄 ellipsis
  if (lines.length > 2) lines.length = 2;

  // 마지막 줄도 폭 초과면 truncate
  lines[0] = truncateByWidth(lines[0], fontSize, maxWidthPx);
  if (lines[1]) lines[1] = truncateByWidth(lines[1], fontSize, maxWidthPx);

  // 원문이 더 길었던 경우, 마지막 줄 끝을 …로 보장
  const joined = lines.join(" ");
  if (joined.length < t.length) {
    const last = lines[Math.min(1, lines.length - 1)] || "";
    if (!last.endsWith("…")) {
      lines[Math.min(1, lines.length - 1)] = truncateByWidth(last + "…", fontSize, maxWidthPx);
    }
  }

  return lines.filter((x) => x.trim().length > 0);
}

/** =========================
 *  11) text parsing helpers (fallback용)
 * ========================= */
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

  const bulletLines = lines.map((l) => l.replace(bulletRe, "").trim()).filter((l) => l.length > 0);

  if (hadBullet && bulletLines.length >= 2) return normalizeLabels(bulletLines);
  if (lines.length >= 2) return normalizeLabels(lines);
  return [];
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
  // 첫 줄이 너무 길지 않으면 타이틀로
  const firstLine = t.split(/\r?\n/)[0]?.trim() || "";
  if (firstLine.length >= 8 && firstLine.length <= 120) return firstLine;
  return "";
}

