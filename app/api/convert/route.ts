export const runtime = "nodejs";

/**
 * paper2figure - editable SVG poster template (detail v2)
 * Goal: maximize editability (PPT/Figma) via many vector sub-elements.
 * No raster images, no clipPath, minimal filters.
 */

function esc(v: any) {
  const s = v == null ? "" : String(v);
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type Theme = "blue" | "orange" | "green" | "purple";

function colors(theme: Theme) {
  switch (theme) {
    case "blue":
      return { head: "#2F6FED", pane: "#EAF2FF", border: "#7FA8FF", accent: "#1D4ED8" };
    case "orange":
      return { head: "#E07A1F", pane: "#FFF2E3", border: "#F1B074", accent: "#C2410C" };
    case "green":
      return { head: "#1F9D57", pane: "#EAF8EF", border: "#7AD3A5", accent: "#15803D" };
    case "purple":
      return { head: "#6D4BC3", pane: "#F3ECFF", border: "#B7A3EA", accent: "#5B21B6" };
  }
}

function defs() {
  return `
<defs>
  <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
    <path d="M0,0 L12,6 L0,12 Z" fill="#111827"/>
  </marker>
</defs>`.trim();
}

// --- small primitives (fully editable)
function pill(id: string, x: number, y: number, text: string, fill = "#111827", txt = "#ffffff") {
  const w = Math.max(52, text.length * 6.5 + 18);
  return `
<g id="${esc(id)}">
  <rect x="${x}" y="${y}" width="${w}" height="22" rx="11" fill="${fill}" opacity="0.92"/>
  <text x="${x + w / 2}" y="${y + 15}" text-anchor="middle"
        font-family="Arial" font-size="11" font-weight="700" fill="${txt}">${esc(text)}</text>
</g>`.trim();
}

function dashedContainer(id: string, x: number, y: number, w: number, h: number, title?: string, stroke = "#94a3b8") {
  return `
<g id="${esc(id)}">
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14"
        fill="#ffffff" opacity="0.55"
        stroke="${stroke}" stroke-width="1.6" stroke-dasharray="6 5"/>
  ${
    title
      ? `<text x="${x + 12}" y="${y + 22}" font-family="Arial" font-size="12" font-weight="800" fill="#334155">${esc(
          title
        )}</text>`
      : ""
  }
</g>`.trim();
}

function textWrapTspans(text: string, maxCharsPerLine: number) {
  // cheap wrap by character count (deterministic, good enough for diagrams)
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxCharsPerLine && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4); // cap
}

function labelBlock(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  variant: "data" | "model" | "func" | "embed",
  icon?: string,
  sublabel?: string
) {
  const style =
    variant === "model"
      ? { fill: "#0B1220", stroke: "#0B1220", text: "#F8FAFC" }
      : variant === "func"
      ? { fill: "#F1F5F9", stroke: "#64748B", text: "#0f172a" }
      : variant === "embed"
      ? { fill: "#FFFFFF", stroke: "#64748B", text: "#0f172a", dash: "6 4" }
      : { fill: "#FFFFFF", stroke: "#94a3b8", text: "#0f172a" };

  const dash = (style as any).dash ? `stroke-dasharray="${(style as any).dash}"` : "";

  const iconX = x + 12;
  const iconY = y + 12;

  const lines = textWrapTspans(title, Math.max(18, Math.floor((w - (icon ? 66 : 20)) / 6.2)));
  const tx = x + (icon ? 62 : 14);
  const ty = y + 28;

  const tspan = lines
    .map((ln, i) => `<tspan x="${tx}" dy="${i === 0 ? 0 : 14}">${esc(ln)}</tspan>`)
    .join("");

  const sub = sublabel
    ? `<text x="${tx}" y="${y + h - 12}" font-family="Arial" font-size="10" fill="${
        variant === "model" ? "#CBD5E1" : "#64748B"
      }">${esc(sublabel)}</text>`
    : "";

  return `
<g id="${esc(id)}">
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14"
        fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.6" ${dash}/>
  ${icon ? `<g id="${esc(id)}_icon" transform="translate(${iconX},${iconY})">${icon}</g>` : ""}
  <text id="${esc(id)}_label" x="${tx}" y="${ty}" font-family="Arial" font-size="12" font-weight="800" fill="${style.text}">
    ${tspan}
  </text>
  ${sub}
</g>`.trim();
}

// --- vector icons (simple, editable)
function iconImageMini() {
  return `
<g>
  <rect x="0" y="0" width="38" height="28" rx="6" fill="#fff" stroke="#94a3b8"/>
  <path d="M6 20 L14 14 L20 18 L28 10 L32 14 L32 24 L6 24 Z" fill="#e2e8f0" stroke="#94a3b8" stroke-width="0.8"/>
  <circle cx="14" cy="10" r="2.5" fill="#94a3b8"/>
</g>`.trim();
}

function iconStackMini() {
  return `
<g>
  <rect x="8" y="0" width="38" height="28" rx="6" fill="#fff" stroke="#94a3b8"/>
  <rect x="4" y="4" width="38" height="28" rx="6" fill="#fff" stroke="#94a3b8"/>
  <rect x="0" y="8" width="38" height="28" rx="6" fill="#fff" stroke="#94a3b8"/>
</g>`.trim();
}

function iconBubbleMini() {
  return `
<g>
  <path d="M0 6 h44 a10 10 0 0 1 10 10 v10 a10 10 0 0 1-10 10 h-18 l-10 10 v-10 h-16 a10 10 0 0 1-10-10 v-10 a10 10 0 0 1 10-10 z"
        fill="#fff" stroke="#94a3b8"/>
</g>`.trim();
}

function iconCylinderMini(fill: string) {
  return `
<g>
  <ellipse cx="19" cy="6" rx="16" ry="6" fill="${fill}" stroke="#64748B"/>
  <rect x="3" y="6" width="32" height="20" fill="${fill}" stroke="#64748B"/>
  <ellipse cx="19" cy="26" rx="16" ry="6" fill="${fill}" stroke="#64748B"/>
</g>`.trim();
}

function iconMaskMini() {
  return `
<g>
  <rect x="0" y="0" width="38" height="28" rx="8" fill="#0f172a" opacity="0.08" stroke="#94a3b8"/>
  <path d="M8 22 C6 12, 14 6, 18 12 C20 6, 30 8, 28 16 C28 24, 16 26, 8 22 Z" fill="#111827" opacity="0.55"/>
</g>`.trim();
}

function formulaBox(id: string, x: number, y: number, w: number, h: number, text: string) {
  return `
<g id="${esc(id)}">
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#ffffff" stroke="#94a3b8" stroke-width="1.2"/>
  <text x="${x + 12}" y="${y + Math.floor(h / 2) + 4}" font-family="Arial" font-size="12" font-weight="800" fill="#0f172a">
    ${esc(text)}
  </text>
</g>`.trim();
}

function elbowArrow(x1: number, y1: number, x2: number, y2: number, label?: string, dashed?: boolean, color = "#111827") {
  const midX = (x1 + x2) / 2;
  const dash = dashed ? `stroke-dasharray="7 6"` : "";
  return `
<g>
  <path d="M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}"
        fill="none" stroke="${color}" stroke-width="1.8" marker-end="url(#arrow)" ${dash}/>
  ${
    label
      ? `<text x="${midX + 6}" y="${y2 - 8}" font-family="Arial" font-size="11" fill="#334155">${esc(
          label
        )}</text>`
      : ""
  }
</g>`.trim();
}

function curveArrow(x1: number, y1: number, x2: number, y2: number, color = "#111827") {
  const c1x = x1 + 90;
  const c1y = y1 - 90;
  const c2x = x2 + 90;
  const c2y = y2 - 90;
  return `
<path d="M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}"
      fill="none" stroke="${color}" stroke-width="1.8" marker-end="url(#arrow)" />`.trim();
}

function buildPosterSvg(title: string) {
  const W = 1536;
  const H = 980;
  const pad = 24;

  const stageGap = 18;
  const stageW = Math.floor((W - pad * 2 - stageGap * 3) / 4);
  const stageH = H - pad * 2;
  const headerH = 56;

  const stageX = [
    pad + (stageW + stageGap) * 0,
    pad + (stageW + stageGap) * 1,
    pad + (stageW + stageGap) * 2,
    pad + (stageW + stageGap) * 3,
  ];

  const stages = [
    { id: "s1", title: "Inputs & Initial Proposals", theme: "blue" as const },
    { id: "s2", title: "Multi-modal Box Re-weighting & Filtering", theme: "orange" as const },
    { id: "s3", title: "Iterative Segmentation (SAM) & Selection", theme: "green" as const },
    { id: "s4", title: "Final Output & Evaluation", theme: "purple" as const },
  ];

  const panels = stages
    .map((s, i) => {
      const c = colors(s.theme);
      const x = stageX[i];
      const y = pad + 58;
      return `
<g id="panel_${esc(s.id)}">
  <rect x="${x}" y="${y}" width="${stageW}" height="${stageH - 58}" rx="18" fill="${c.pane}" stroke="${c.border}" stroke-width="2"/>
  <rect x="${x}" y="${y}" width="${stageW}" height="${headerH}" rx="18" fill="${c.head}" opacity="0.96"/>
  <text x="${x + 16}" y="${y + 36}" font-family="Arial" font-size="15" font-weight="900" fill="#ffffff">${esc(
    s.title
  )}</text>
</g>`.trim();
    })
    .join("\n");

  const paneTop = pad + 58 + headerH + 18;
  const boxW = stageW - 34;

  // ---------- Stage 1 (more detailed)
  const s1x = stageX[0] + 17;
  let y = paneTop;

  const n_query = { x: s1x, y, w: boxW, h: 62 };
  y += 62 + 12;
  const n_support = { x: s1x, y, w: boxW, h: 62 };
  y += 62 + 12;
  const n_text = { x: s1x, y, w: boxW, h: 62 };
  y += 62 + 16;

  const n_owl = { x: s1x, y, w: boxW, h: 76 };
  y += 76 + 12;
  const n_init = { x: s1x, y, w: boxW, h: 62 };
  y += 62 + 12;

  // bottom encoders
  const encY = (pad + 58) + (stageH - 58) - 190;
  const halfW = Math.floor((boxW - 14) / 2);

  const n_clip_img = { x: s1x, y: encY, w: halfW, h: 66 };
  const n_clip_txt = { x: s1x + halfW + 14, y: encY, w: halfW, h: 66 };

  const n_proto = { x: s1x, y: encY + 78, w: halfW, h: 62 };
  const n_textemb = { x: s1x + halfW + 14, y: encY + 78, w: halfW, h: 62 };

  // ---------- Stage 2 (container + subnodes)
  const s2x = stageX[1] + 17;
  const s2y0 = paneTop;

  const cropCont = { x: s2x, y: s2y0, w: boxW, h: 150 };
  const fusionCont = { x: s2x, y: s2y0 + 160, w: boxW, h: 160 };
  const n_thresh = { x: s2x, y: s2y0 + 330, w: boxW, h: 56 };
  const n_filt = { x: s2x, y: s2y0 + 396, w: boxW, h: 62 };

  // crop container internals
  const qthumb = { x: cropCont.x + 14, y: cropCont.y + 34, w: 86, h: 54 };
  const cthumb = { x: cropCont.x + 114, y: cropCont.y + 34, w: 86, h: 54 };
  const encMini = { x: cropCont.x + 214, y: cropCont.y + 34, w: cropCont.w - 228, h: 54 };
  const cropEmb = { x: cropCont.x + 214, y: cropCont.y + 98, w: cropCont.w - 228, h: 44 };

  // fusion internals
  const simRow = { x: fusionCont.x + 14, y: fusionCont.y + 38, w: fusionCont.w - 28, h: 54 };
  const formula = { x: fusionCont.x + 14, y: fusionCont.y + 100, w: fusionCont.w - 28, h: 46 };
  const inputsNote = { x: fusionCont.x + 14, y: fusionCont.y + 150, w: fusionCont.w - 28, h: 0 }; // just text

  // ---------- Stage 3 (more detailed loop)
  const s3x = stageX[2] + 17;
  const s3y0 = paneTop;

  const n_sam_enc = { x: s3x, y: s3y0, w: boxW, h: 64 };
  const n_img_emb = { x: s3x, y: s3y0 + 76, w: boxW, h: 58 };

  const loop = { x: s3x, y: s3y0 + 148, w: boxW, h: 300 };
  const inPad = 12;

  const pe = { x: loop.x + inPad, y: loop.y + 52, w: Math.floor((loop.w - inPad * 2 - 10) / 2), h: 64 };
  const md = { x: pe.x + pe.w + 10, y: loop.y + 52, w: pe.w, h: 64 };

  const coarse = { x: loop.x + inPad, y: loop.y + 126, w: loop.w - inPad * 2, h: 64 };
  const refine = { x: loop.x + inPad, y: loop.y + 200, w: loop.w - inPad * 2, h: 70 };

  const n_select = { x: s3x, y: loop.y + loop.h + 14, w: boxW, h: 62 };
  const n_best = { x: s3x, y: loop.y + loop.h + 86, w: boxW, h: 58 };

  // ---------- Stage 4 (keep but add sublabels)
  const s4x = stageX[3] + 17;
  const s4y0 = paneTop + 10;

  const n_agg = { x: s4x, y: s4y0, w: boxW, h: 72 };
  const n_pred = { x: s4x, y: s4y0 + 84, w: boxW, h: 62 };
  const n_gt = { x: s4x, y: s4y0 + 156, w: boxW, h: 62 };
  const n_iou = { x: s4x, y: s4y0 + 228, w: boxW, h: 62 };
  const n_miou = { x: s4x, y: s4y0 + 300, w: boxW, h: 56 };

  // ---------- Nodes (lots of editable sub-elements)
  const nodes: string[] = [];

  // Stage 1 nodes
  nodes.push(
    labelBlock("s1_query", n_query.x, n_query.y, n_query.w, n_query.h, "Query Image (N-shot target)", "data", iconImageMini()),
    labelBlock(
      "s1_support",
      n_support.x,
      n_support.y,
      n_support.w,
      n_support.h,
      "Support Set (K-shot Images & Masks)",
      "data",
      iconStackMini()
    ),
    labelBlock(
      "s1_text",
      n_text.x,
      n_text.y,
      n_text.w,
      n_text.h,
      'Class Text Prompt: "a photo of a [class_name]"',
      "data",
      iconBubbleMini()
    ),
    labelBlock(
      "s1_owl",
      n_owl.x,
      n_owl.y,
      n_owl.w,
      n_owl.h,
      "OWL-ViT Detector",
      "model",
      undefined,
      "Open-Vocabulary Detection"
    ),
    labelBlock(
      "s1_init",
      n_init.x,
      n_init.y,
      n_init.w,
      n_init.h,
      "Initial Bounding Boxes & Scores",
      "data",
      iconMaskMini()
    ),
    labelBlock(
      "s1_clip_img",
      n_clip_img.x,
      n_clip_img.y,
      n_clip_img.w,
      n_clip_img.h,
      "CLIP Image Encoder",
      "model",
      undefined,
      "Masked Inputs"
    ),
    labelBlock("s1_clip_txt", n_clip_txt.x, n_clip_txt.y, n_clip_txt.w, n_clip_txt.h, "CLIP Text Encoder", "model"),
    labelBlock(
      "s1_proto",
      n_proto.x,
      n_proto.y,
      n_proto.w,
      n_proto.h,
      "Support Prototypes",
      "embed",
      iconCylinderMini("#DDEAFE"),
      "Avg Embedding"
    ),
    labelBlock(
      "s1_textemb",
      n_textemb.x,
      n_textemb.y,
      n_textemb.w,
      n_textemb.h,
      "Class Text Embedding",
      "embed",
      iconCylinderMini("#FFE7D2")
    )
  );

  // Stage 2 containers + internals
  nodes.push(
    dashedContainer("s2_crop_container", cropCont.x, cropCont.y, cropCont.w, cropCont.h, "Crop & Encode Loop (per Box)", colors("orange").border),
    labelBlock("s2_query_thumb", qthumb.x, qthumb.y, qthumb.w, qthumb.h, "Query (thumbnail)", "data", iconImageMini()),
    labelBlock("s2_crop_thumb", cthumb.x, cthumb.y, cthumb.w, cthumb.h, "Crop (per box)", "data", iconImageMini()),
    labelBlock("s2_clip_enc", encMini.x, encMini.y, encMini.w, encMini.h, "CLIP Image Encoder", "model"),
    labelBlock("s2_crop_emb", cropEmb.x, cropEmb.y, cropEmb.w, cropEmb.h, "Crop Embedding", "embed", iconCylinderMini("#FFF1E6")),

    dashedContainer(
      "s2_fusion_container",
      fusionCont.x,
      fusionCont.y,
      fusionCont.w,
      fusionCont.h,
      "Similarity & Score Fusion Function",
      colors("orange").border
    ),
    labelBlock("s2_cosine", simRow.x, simRow.y, simRow.w, simRow.h, "Cosine Similarity: (Sim_text, Sim_support)", "func"),
    formulaBox("s2_formula", formula.x, formula.y, formula.w, formula.h, "Σ( w_t·Sim_text + w_s·Sim_support + w_p·Norm_score )"),
    labelBlock("s2_thresh", n_thresh.x, n_thresh.y, n_thresh.w, n_thresh.h, "Threshold Filtering (τ = μ + σ)", "func"),
    labelBlock("s2_filtered", n_filt.x, n_filt.y, n_filt.w, n_filt.h, "Filtered High-Confidence Boxes", "data", iconMaskMini())
  );

  // Stage 3 encoder + loop
  nodes.push(
    labelBlock("s3_sam_enc", n_sam_enc.x, n_sam_enc.y, n_sam_enc.w, n_sam_enc.h, "SAM Image Encoder", "model"),
    labelBlock("s3_img_emb", n_img_emb.x, n_img_emb.y, n_img_emb.w, n_img_emb.h, "Image Embeddings", "embed", iconCylinderMini("#DFF5E8")),

    // loop container
    dashedContainer("s3_loop_container", loop.x, loop.y, loop.w, loop.h, "Iterative SAM Refinement Loop", colors("green").border),
    pill("s3_iter1", loop.x + 16, loop.y + 26, "Iter 1: Box Prompt", colors("green").accent),
    pill("s3_iter2", loop.x + 160, loop.y + 26, "Iter 2+: Mask Prompt", colors("green").accent),

    labelBlock("s3_prompt_enc", pe.x, pe.y, pe.w, pe.h, "SAM Prompt Encoder", "model", undefined, "Box / Mask Input"),
    labelBlock("s3_mask_dec", md.x, md.y, md.w, md.h, "SAM Mask Decoder", "model", undefined, "Uses image emb + prompt"),
    labelBlock("s3_coarse", coarse.x, coarse.y, coarse.w, coarse.h, "Coarse Masks / Logits", "data", iconMaskMini()),
    labelBlock("s3_refine", refine.x, refine.y, refine.w, refine.h, "Candidate Masks (Post-Refinement)", "data", iconMaskMini(), "Refined boxes from masks"),

    labelBlock("s3_select", n_select.x, n_select.y, n_select.w, n_select.h, "Final Mask Selection", "func", undefined, "Feature Similarity"),
    labelBlock("s3_best", n_best.x, n_best.y, n_best.w, n_best.h, "Selected Best Masks", "data", iconMaskMini())
  );

  // Stage 4
  nodes.push(
    labelBlock("s4_agg", n_agg.x, n_agg.y, n_agg.w, n_agg.h, "Mask Aggregation (Union)", "func", iconCylinderMini("#EFEAFF")),
    labelBlock("s4_pred", n_pred.x, n_pred.y, n_pred.w, n_pred.h, "Final Prediction Mask", "data", iconMaskMini()),
    labelBlock("s4_gt", n_gt.x, n_gt.y, n_gt.w, n_gt.h, "Ground Truth Query Mask", "data", iconMaskMini()),
    labelBlock("s4_iou", n_iou.x, n_iou.y, n_iou.w, n_iou.h, "IoU Evaluation Metric", "func"),
    labelBlock("s4_miou", n_miou.x, n_miou.y, n_miou.w, n_miou.h, "mIoU Score", "data")
  );

  // ---------- Arrows (more granular)
  const cx = (b: any) => b.x + b.w / 2;
  const cy = (b: any) => b.y + b.h / 2;
  const right = (b: any) => ({ x: b.x + b.w, y: cy(b) });
  const left = (b: any) => ({ x: b.x, y: cy(b) });

  const arrows: string[] = [];

  // Stage 1 -> OWL
  arrows.push(
    elbowArrow(cx(n_query), n_query.y + n_query.h, cx(n_owl), n_owl.y, "image", false),
    elbowArrow(cx(n_text), n_text.y + n_text.h, cx(n_owl), n_owl.y, "text", false),
    elbowArrow(cx(n_owl), n_owl.y + n_owl.h, cx(n_init), n_init.y, "boxes+scores", false)
  );

  // Support -> CLIP img, Text -> CLIP txt
  arrows.push(
    elbowArrow(cx(n_support), n_support.y + n_support.h, cx(n_clip_img), n_clip_img.y, "masked imgs", true),
    elbowArrow(cx(n_text), n_text.y + n_text.h, cx(n_clip_txt), n_clip_txt.y, "prompt", true),
    elbowArrow(cx(n_clip_img), n_clip_img.y + n_clip_img.h, cx(n_proto), n_proto.y, "avg", false),
    elbowArrow(cx(n_clip_txt), n_clip_txt.y + n_clip_txt.h, cx(n_textemb), n_textemb.y, "emb", false)
  );

  // Stage 1 -> Stage 2: init boxes -> crop loop, query image -> query thumb
  arrows.push(
    elbowArrow(right(n_init).x, right(n_init).y, left(cropCont).x, left(cropCont).y + 24, "per-box", false),
    elbowArrow(right(n_query).x, right(n_query).y, left(qthumb).x, left(qthumb).y, "thumbnail", true)
  );

  // Inside Stage2 crop: query thumb -> crop thumb -> encoder -> crop emb
  arrows.push(
    elbowArrow(right(qthumb).x, right(qthumb).y, left(cthumb).x, left(cthumb).y, "crop", false, colors("orange").accent),
    elbowArrow(right(cthumb).x, right(cthumb).y, left(encMini).x, left(encMini).y, "encode", false, colors("orange").accent),
    elbowArrow(cx(encMini), encMini.y + encMini.h, cx(cropEmb), cropEmb.y, "crop emb", false, colors("orange").accent)
  );

  // Crop emb + proto + text emb + score -> fusion (long arrows)
  arrows.push(
    elbowArrow(right(cropEmb).x, right(cropEmb).y, left(fusionCont).x, left(fusionCont).y + 36, "crop emb", false),
    elbowArrow(right(n_proto).x, right(n_proto).y, left(fusionCont).x, left(fusionCont).y + 64, "support proto", true),
    elbowArrow(right(n_textemb).x, right(n_textemb).y, left(fusionCont).x, left(fusionCont).y + 92, "text emb", true),
    elbowArrow(right(n_init).x, right(n_init).y + 22, left(fusionCont).x, left(fusionCont).y + 120, "norm score", true)
  );

  // Fusion -> thresh -> filtered
  arrows.push(
    elbowArrow(cx(fusionCont), fusionCont.y + fusionCont.h, cx(n_thresh), n_thresh.y, "fused score", false),
    elbowArrow(cx(n_thresh), n_thresh.y + n_thresh.h, cx(n_filt), n_filt.y, undefined, false)
  );

  // Stage2 -> Stage3
  arrows.push(
    elbowArrow(right(n_filt).x, right(n_filt).y, left(n_sam_enc).x, left(n_sam_enc).y, "filtered boxes", false),
    elbowArrow(right(n_query).x, right(n_query).y + 26, left(n_sam_enc).x, left(n_sam_enc).y + 18, "query image", true)
  );

  // Stage3 encoder
  arrows.push(elbowArrow(cx(n_sam_enc), n_sam_enc.y + n_sam_enc.h, cx(n_img_emb), n_img_emb.y, "image emb", false));

  // Into loop: img emb -> decoder, filtered boxes -> prompt encoder
  arrows.push(
    elbowArrow(cx(n_img_emb), n_img_emb.y + n_img_emb.h, cx(md), md.y, "to decoder", false, colors("green").accent),
    elbowArrow(right(n_filt).x, right(n_filt).y + 18, left(pe).x, left(pe).y, "box prompt", false, colors("green").accent)
  );

  // prompt -> decoder -> coarse -> refine
  arrows.push(
    elbowArrow(right(pe).x, right(pe).y, left(md).x, left(md).y, "prompt", false, colors("green").accent),
    elbowArrow(cx(md), md.y + md.h, cx(coarse), coarse.y, "decode", false, colors("green").accent),
    elbowArrow(cx(coarse), coarse.y + coarse.h, cx(refine), refine.y, "refine", false, colors("green").accent)
  );

  // feedback: refine -> prompt encoder (mask input)
  arrows.push(curveArrow(refine.x + refine.w * 0.25, refine.y + refine.h, pe.x + pe.w * 0.2, pe.y, colors("green").accent));

  // selection
  arrows.push(
    elbowArrow(cx(refine), refine.y + refine.h, cx(n_select), n_select.y, undefined, false),
    elbowArrow(right(n_textemb).x, right(n_textemb).y + 10, left(n_select).x, left(n_select).y, "class text emb", true),
    elbowArrow(cx(n_select), n_select.y + n_select.h, cx(n_best), n_best.y, undefined, false)
  );

  // Stage3 -> Stage4
  arrows.push(elbowArrow(right(n_best).x, right(n_best).y, left(n_agg).x, left(n_agg).y, "best masks", false));

  // Stage4 flow
  arrows.push(
    elbowArrow(cx(n_agg), n_agg.y + n_agg.h, cx(n_pred), n_pred.y, "union", false),
    elbowArrow(cx(n_pred), n_pred.y + n_pred.h, cx(n_iou), n_iou.y, undefined, false),
    elbowArrow(cx(n_gt), n_gt.y + n_gt.h, cx(n_iou), n_iou.y, "GT", false),
    elbowArrow(cx(n_iou), n_iou.y + n_iou.h, cx(n_miou), n_miou.y, undefined, false)
  );

  const titleSvg = `
<g id="title">
  <text x="${W / 2}" y="38" text-anchor="middle"
        font-family="Arial" font-size="24" font-weight="900" fill="#0f172a">${esc(title)}</text>
  <line x1="${pad}" y1="52" x2="${W - pad}" y2="52" stroke="#0f172a" opacity="0.15" stroke-width="2"/>
</g>`.trim();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${defs()}
  <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>
  ${titleSvg}
  ${panels}
  <g id="edges">
    ${arrows.join("\n")}
  </g>
  <g id="nodes">
    ${nodes.join("\n")}
  </g>
</svg>`;
}

export async function POST(req: Request) {
  try {
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
    return new Response(e?.message ?? "Internal error", { status: 500 });
  }
}

