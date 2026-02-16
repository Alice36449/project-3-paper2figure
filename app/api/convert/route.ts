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

/** ====== POST 핸들러 ====== */
export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const prompt =
      typeof form.get("prompt") === "string" ? (form.get("prompt") as string) : "";

    const stylePreset =
      typeof form.get("stylePreset") === "string" ? (form.get("stylePreset") as string) : "clean";

    const layout =
      typeof form.get("layout") === "string" ? (form.get("layout") as string) : "auto";

    const detailRaw =
      typeof form.get("detail") === "string" ? (form.get("detail") as string) : "70";
    const detail = Math.max(0, Math.min(100, Number(detailRaw) || 70));

    const yamlText = buildYamlFromPrompt({
      prompt,
      stylePreset,
      detail,
      layout,
    });

    const blueprint = parseYAML(yamlText) as Blueprint;

    if (
      !blueprint?.canvas?.width ||
      !blueprint?.canvas?.height ||
      !Array.isArray(blueprint.elements)
    ) {
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

/** ====== 렌더러 ====== */
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

  const secondary = (bp.style?.fills?.secondary ?? "").toLowerCase();
  const isLight = secondary === "#ffffff" || secondary === "white";

  // 배경
  const bg = rect(0, 0, W, H, 0, isLight ? "#FFFFFF" : style.fillSecondary, "none", 0);

  // 프레임
  const frame = isLight
    ? rect(40, 40, W - 80, H - 80, 12, "none", "#E5E7EB", 1.2, 1)
    : rect(70, 90, W - 140, H - 160, 26, "#0F1730", style.highlight, 2, 0.35);

  // 헤더 색
  const titleColor = isLight ? "#111827" : "#E5E7EB";
  const notesColor = isLight ? "#374151" : "#9CA3AF";

  const header = `
    <g id="header">
      ${text(110, 165, title, style.font, 42, titleColor, 700)}
      ${text(110, 205, notes, style.font, 16, notesColor, 400)}
    </g>
  `;

  // 마커(arrowhead)
  const defs = `
  <defs>
    <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L12,6 L0,12 Z" fill="${isLight ? "#111827" : style.highlight}" fill-opacity="0.65"/>
    </marker>
  </defs>
  `.trim();

  // 커넥터 → 노드 순서 (선이 뒤로 가게)
  const edgesSvg = (bp.connectors ?? [])
    .map((c) => renderConnector(c, nodeMap, style, isLight))
    .join("\n");

  const nodesSvg = bp.elements
    .map((el) => renderNode(el, style, isLight))
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
  style: { font: string; fontSize: number; stroke: string; strokeWidth: number; highlight: string; fillPrimary: string },
  isLight: boolean
) {
  const fill = el.fill ?? style.fillPrimary;
  const stroke = el.stroke ?? style.stroke;

  // PPT 편집 편하게: 각 노드 그룹 id 고정
  const gid = `node_${sanitizeId(el.id)}`;

  const rx = el.type === "pill" ? Math.min(el.h / 2, 999) : 18;

  // 라이트면 outlineOpacity 1로(또렷하게), 다크면 살짝만
  const outlineOpacity = isLight ? 1 : 0.18;

  const box = rect(el.x, el.y, el.w, el.h, rx, fill, stroke, style.strokeWidth, outlineOpacity);

  // 라벨
  const lines = el.label_lines ?? [];
  const paddingX = 22;
  const paddingTop = 42;

  const lineGap = Math.round(style.fontSize * 1.25);
  const startY = el.y + paddingTop;

  const labelFill = isLight ? "#111827" : "#E5E7EB";

  const label = lines
    .map((ln, i) =>
      text(
        el.x + paddingX,
        startY + i * lineGap,
        ln,
        style.font,
        style.fontSize,
        labelFill,
        i === 0 ? 700 : 400
      )
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
  isLight: boolean
) {
  const from = nodeMap.get(c.from);
  const to = nodeMap.get(c.to);
  if (!from || !to) return "";

  const gid = `edge_${sanitizeId(c.id)}`;

  // anchor 자동
  const a = pickAnchor(from, to);
  const b = pickAnchor(to, from);

  const x1 = a.x, y1 = a.y;
  const x2 = b.x, y2 = b.y;

  const pathD = `M ${x1} ${y1} L ${x2} ${y2}`;

  // 라이트에서는 검정 계열
  const stroke = isLight ? "#111827" : style.highlight;
  const strokeOpacity = isLight ? 0.85 : 0.55;
  const strokeWidth = isLight ? 2 : 3;

  const line = `<path d="${pathD}" stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}" fill="none" marker-end="url(#arrow)"/>`;

  // 라벨(중간)
  const label = c.label?.trim();
  if (!label) {
    return `
    <g id="${gid}">
      ${line}
    </g>
    `.trim();
  }

  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  const labelBg = isLight ? "#FFFFFF" : "#0B1020";
  const labelBgOpacity = isLight ? 0.92 : 0.75;
  const labelStroke = isLight ? "rgba(17,24,39,0.25)" : "rgba(229,231,235,0.16)";
  const labelText = isLight ? "#111827" : "#E5E7EB";

  const labelSvg = `
      <g id="${gid}_label">
        <rect x="${mx - 36}" y="${my - 14}" width="72" height="24" rx="10"
          fill="${labelBg}" fill-opacity="${labelBgOpacity}" stroke="${labelStroke}" stroke-width="1"/>
        <text x="${mx}" y="${my + 4}" text-anchor="middle"
          font-family="Arial" font-size="12" fill="${labelText}">${escapeXml(label)}</text>
      </g>
  `;

  return `
  <g id="${gid}">
    ${line}
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
  return (s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeYaml(s: string) {
  return (s ?? "").replaceAll('"', '\\"').replaceAll("\n", " ");
}

function sanitizeId(id: string) {
  return (id ?? "").replace(/[^a-zA-Z0-9_\-]/g, "_");
}

/** ====== prompt -> yaml ====== */
type BuildArgs = {
  prompt: string;
  stylePreset?: string; // clean/minimal/poster/ppt/light
  detail?: number;      // 0~100
  layout?: string;      // auto / left-to-right / top-down
};

function buildYamlFromPrompt(args: BuildArgs) {
  const raw = (args.prompt || "").trim();
  const stylePreset = (args.stylePreset || "clean").toLowerCase();
  const detail = clampNumber(args.detail ?? 70, 0, 100);
  const layout = (args.layout || "auto").toLowerCase();

  const steps = parseSteps(raw);

  const nodes = steps.length ? steps : ["Input", "Process", "Output"];

  const withDesc = detail >= 60;
  const withExtra = detail >= 85;

  const dir: "left-to-right" | "top-down" = layout === "top-down" ? "top-down" : "left-to-right";

  const canvas = pickCanvas(nodes.length, dir);
  const style = pickStyle(stylePreset);

  const elements = autoLayoutElements(nodes, {
    dir,
    canvasW: canvas.width,
    canvasH: canvas.height,
    stylePreset,
    withDesc,
  });

  const connectors = [];
  for (let i = 0; i < elements.length - 1; i++) {
    connectors.push({
      id: `c${i + 1}`,
      from: elements[i].id,
      to: elements[i + 1].id,
      type: "straight",
      anchor: "auto",
      label: withExtra ? (i === 0 ? "next" : "") : "",
    });
  }

  const titleRaw =
    nodes.length <= 5 ? nodes.map(n => n.replace(/\n/g, " ")).join(" → ")
                      : `${nodes[0].replace(/\n/g, " ")} → ... → ${nodes[nodes.length - 1].replace(/\n/g, " ")}`;

  const title = truncate(titleRaw, 42);
  const notes = raw ? `prompt: ${truncate(raw.replace(/\s+/g, " "), 90)}` : "no prompt";

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
  font_family: ${style.font_family}
  font_size: ${style.font_size}
  stroke: "${style.stroke}"
  stroke_width: ${style.stroke_width}
  fills:
    primary: "${style.fills.primary}"
    secondary: "${style.fills.secondary}"
    highlight: "${style.fills.highlight}"

elements:
${elements.map(e => elementYaml(e)).join("\n")}

connectors:
${connectors.map(c => connectorYaml(c)).join("\n")}
`.trim();

  return yaml;
}

function parseSteps(prompt: string): string[] {
  if (!prompt) return [];

  if (prompt.includes("->") || prompt.includes("→")) {
    const arrow = prompt.includes("->") ? "->" : "→";
    const parts = prompt.split(arrow).map(s => s.trim()).filter(Boolean);
    return normalizeLabels(parts);
  }

  const lines = prompt
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const bulletRe = /^(\d+[\).\]]\s+|[-*•]\s+)/;

  const bulletLines = lines
    .map(l => l.replace(bulletRe, "").trim())
    .filter(l => l.length > 0);

  const hadBullet = lines.some(l => bulletRe.test(l));
  if (hadBullet && bulletLines.length >= 2) return normalizeLabels(bulletLines);

  if (lines.length >= 2) return normalizeLabels(lines);

  return [];
}

function normalizeLabels(labels: string[]) {
  return labels.map((s) => {
    const t = s.replace(/\s+/g, " ").trim();
    // 노드 내부용 2줄 wrap
    const lines = wrapToLines(t, 22, 2);
    return lines.join("\n"); // autoLayout에서 split("\n")로 들어감
  });
}

function pickCanvas(n: number, dir: "left-to-right" | "top-down") {
  const baseW = 1200;
  const baseH = 720;

  if (dir === "top-down") {
    const h = Math.max(baseH, 220 + n * 160);
    return { width: baseW, height: h, aspect: "auto" };
  } else {
    const w = Math.max(baseW, 240 + n * 260);
    return { width: w, height: baseH, aspect: "auto" };
  }
}

function pickStyle(preset: string) {
  if (preset === "ppt" || preset === "light") {
    return {
      font_family: "Arial",
      font_size: 18,
      stroke: "#111827",
      stroke_width: 1.5,
      fills: {
        primary: "#FFFFFF",
        secondary: "#FFFFFF", // 배경 흰색
        highlight: "#111827", // 화살표/텍스트 검정
      },
    };
  }

  if (preset === "minimal") {
    return {
      font_family: "Arial",
      font_size: 17,
      stroke: "#E5E7EB",
      stroke_width: 2,
      fills: { primary: "#0F172A", secondary: "#05070F", highlight: "#22D3EE" },
    };
  }

  if (preset === "poster") {
    return {
      font_family: "Arial",
      font_size: 20,
      stroke: "#E5E7EB",
      stroke_width: 2,
      fills: { primary: "#101A36", secondary: "#0B1020", highlight: "#38BDF8" },
    };
  }

  return {
    font_family: "Arial",
    font_size: 18,
    stroke: "#E5E7EB",
    stroke_width: 2,
    fills: { primary: "#101A36", secondary: "#0B1020", highlight: "#22D3EE" },
  };
}

function autoLayoutElements(
  labels: string[],
  opts: { dir: "left-to-right" | "top-down"; canvasW: number; canvasH: number; stylePreset: string; withDesc: boolean }
) {
  const { dir, canvasW, canvasH, withDesc } = opts;

  const marginX = 120;
  const marginY = 220;
  const boxW = 340;
  const boxH = 150;

  const gapX = 140;
  const gapY = 90;

  const isPpt = opts.stylePreset === "ppt" || opts.stylePreset === "light";
  const pastel = ["#F3F4F6", "#DBEAFE", "#DCFCE7", "#FFEDD5"]; // gray/blue/green/orange

  const elements: Array<{
    id: string;
    type: string;
    x: number; y: number; w: number; h: number;
    fill?: string; stroke?: string;
    label_lines: string[];
  }> = [];

  if (dir === "top-down") {
    let x = Math.max(90, Math.floor((canvasW - boxW) / 2));
    let y = marginY;

    labels.forEach((lab, i) => {
      const id = `n${i + 1}`;
      const baseLines = String(lab).split("\n");

      elements.push({
        id,
        type: "box",
        x,
        y,
        w: boxW,
        h: boxH,
        fill: isPpt ? pastel[i % pastel.length] : undefined,
        stroke: isPpt ? "#111827" : undefined,
        label_lines: withDesc ? [...baseLines, ""] : baseLines,
      });

      y += boxH + gapY;
    });
  } else {
    let x = marginX;
    let y = Math.max(200, Math.floor((canvasH - boxH) / 2));

    labels.forEach((lab, i) => {
      const id = `n${i + 1}`;
      const baseLines = String(lab).split("\n");

      elements.push({
        id,
        type: "box",
        x,
        y,
        w: boxW,
        h: boxH,
        fill: isPpt ? pastel[i % pastel.length] : undefined,
        stroke: isPpt ? "#111827" : undefined,
        label_lines: withDesc ? [...baseLines, ""] : baseLines,
      });

      x += boxW + gapX;
    });
  }

  return elements;
}

function elementYaml(e: any) {
  const lines = e.label_lines || [];
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

function clampNumber(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function truncate(s: string, max: number) {
  const t = (s ?? "").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function wrapToLines(text: string, maxCharsPerLine: number, maxLines: number) {
  const words = (text ?? "").split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";

  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxCharsPerLine) {
      cur = next;
    } else {
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
