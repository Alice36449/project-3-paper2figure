export const runtime = "nodejs";

// NOTE: 전용 템플릿. "이 프롬프트 넣으면 저 포스터처럼"을 가장 확실히 만족.
//       (LLM spec 생성은 변동성이 있어서, 이런 고정 파이프라인은 템플릿이 정답)

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
      return { head: "#2F6FED", pane: "#EAF2FF", border: "#7FA8FF" };
    case "orange":
      return { head: "#E07A1F", pane: "#FFF2E3", border: "#F1B074" };
    case "green":
      return { head: "#1F9D57", pane: "#EAF8EF", border: "#7AD3A5" };
    case "purple":
      return { head: "#6D4BC3", pane: "#F3ECFF", border: "#B7A3EA" };
  }
}

function markerDefs() {
  return `
<defs>
  <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
    <path d="M0,0 L12,6 L0,12 Z" fill="#111827"/>
  </marker>
  <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.12"/>
  </filter>
</defs>`.trim();
}

function iconImage(x: number, y: number) {
  return `
<g>
  <rect x="${x}" y="${y}" width="44" height="34" rx="6" fill="#fff" stroke="#94a3b8"/>
  <path d="M${x+6} ${y+26} L${x+16} ${y+16} L${x+24} ${y+22} L${x+34} ${y+12} L${x+38} ${y+18} L${x+38} ${y+28} L${x+6} ${y+28} Z"
        fill="#e2e8f0" stroke="#94a3b8" stroke-width="0.8"/>
  <circle cx="${x+16}" cy="${y+12}" r="3" fill="#94a3b8"/>
</g>`.trim();
}

function iconStack(x: number, y: number) {
  return `
<g>
  <rect x="${x+10}" y="${y}" width="44" height="34" rx="6" fill="#fff" stroke="#94a3b8"/>
  <rect x="${x+6}" y="${y+4}" width="44" height="34" rx="6" fill="#fff" stroke="#94a3b8"/>
  <rect x="${x}" y="${y+8}" width="44" height="34" rx="6" fill="#fff" stroke="#94a3b8"/>
</g>`.trim();
}

function iconBubble(x: number, y: number) {
  return `
<g>
  <path d="M${x} ${y+6} h50 a10 10 0 0 1 10 10 v16 a10 10 0 0 1-10 10 h-24 l-10 10 v-10 h-16 a10 10 0 0 1-10-10 v-16 a10 10 0 0 1 10-10 z"
        fill="#fff" stroke="#94a3b8"/>
</g>`.trim();
}

function iconCylinder(x: number, y: number, fill: string) {
  return `
<g>
  <ellipse cx="${x+24}" cy="${y+8}" rx="20" ry="8" fill="${fill}" stroke="#64748B"/>
  <rect x="${x+4}" y="${y+8}" width="40" height="26" fill="${fill}" stroke="#64748B"/>
  <ellipse cx="${x+24}" cy="${y+34}" rx="20" ry="8" fill="${fill}" stroke="#64748B"/>
</g>`.trim();
}

function iconMask(x: number, y: number) {
  return `
<g>
  <rect x="${x}" y="${y}" width="44" height="34" rx="8" fill="#0f172a" opacity="0.08" stroke="#94a3b8"/>
  <path d="M${x+10} ${y+26} C${x+6} ${y+14}, ${x+16} ${y+8}, ${x+22} ${y+14}
           C${x+26} ${y+6}, ${x+36} ${y+10}, ${x+34} ${y+20}
           C${x+34} ${y+30}, ${x+18} ${y+32}, ${x+10} ${y+26} Z"
        fill="#111827" opacity="0.55"/>
</g>`.trim();
}

function nodeBox(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  variant: "data" | "model" | "func" | "embed",
  icon?: string
) {
  const style =
    variant === "model"
      ? { fill: "#0B1220", stroke: "#111827", text: "#F8FAFC" }
      : variant === "func"
      ? { fill: "#F1F5F9", stroke: "#64748B", text: "#0f172a" }
      : variant === "embed"
      ? { fill: "#FFFFFF", stroke: "#64748B", text: "#0f172a", dash: "6 4" }
      : { fill: "#FFFFFF", stroke: "#94a3b8", text: "#0f172a" };

  const dash = (style as any).dash ? `stroke-dasharray="${(style as any).dash}"` : "";
  const iconX = x + 14;
  const iconY = y + 14;

  return `
<g id="${esc(id)}" filter="url(#softShadow)">
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14"
        fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.6" ${dash}/>
  ${icon ? `<g transform="translate(${iconX},${iconY})">${icon}</g>` : ""}
  <text x="${x + (icon ? 72 : 18)}" y="${y + 34}"
        font-family="Arial" font-size="13" font-weight="700" fill="${style.text}">
    ${esc(label)}
  </text>
</g>`.trim();
}

function elbowArrow(x1: number, y1: number, x2: number, y2: number, label?: string, dashed?: boolean) {
  const midX = (x1 + x2) / 2;
  const dash = dashed ? `stroke-dasharray="7 6"` : "";
  return `
<g>
  <path d="M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}"
        fill="none" stroke="#111827" stroke-width="1.8" marker-end="url(#arrow)" ${dash}/>
  ${label ? `<text x="${midX+6}" y="${y2-8}" font-family="Arial" font-size="11" fill="#334155">${esc(label)}</text>` : ""}
</g>`.trim();
}

function curveArrow(x1: number, y1: number, x2: number, y2: number) {
  // feedback loop
  const c1x = x1 + 90;
  const c1y = y1 - 90;
  const c2x = x2 + 90;
  const c2y = y2 - 90;
  return `
<path d="M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}"
      fill="none" stroke="#111827" stroke-width="1.8" marker-end="url(#arrow)" />`.trim();
}

function buildPosterSvg(title: string) {
  const W = 1536;
  const H = 900; // 포스터 느낌으로 약간 낮춤 (너 preview에서 덜 스크롤)
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
    { title: "Inputs & Initial Proposals", theme: "blue" as const },
    { title: "Multi-modal Box Re-weighting & Filtering", theme: "orange" as const },
    { title: "Iterative Segmentation (SAM) & Selection", theme: "green" as const },
    { title: "Final Output & Evaluation", theme: "purple" as const },
  ];

  // Panels
  const panels = stages
    .map((s, i) => {
      const c = colors(s.theme);
      const x = stageX[i];
      const y = pad + 58; // 상단 타이틀 공간 확보
      return `
<g>
  <rect x="${x}" y="${y}" width="${stageW}" height="${stageH - 58}" rx="18" fill="${c.pane}" stroke="${c.border}" stroke-width="2"/>
  <rect x="${x}" y="${y}" width="${stageW}" height="${headerH}" rx="18" fill="${c.head}" opacity="0.96"/>
  <text x="${x+16}" y="${y+36}" font-family="Arial" font-size="15" font-weight="800" fill="#ffffff">${esc(s.title)}</text>
</g>`.trim();
    })
    .join("\n");

  // Common geometry helpers
  const paneTop = pad + 58 + headerH + 18;

  const boxW = stageW - 34;
  const boxH = 70;

  // --- Stage 1 positions
  const s1x = stageX[0] + 17;
  let y1 = paneTop;

  const n_query = { x: s1x, y: y1, w: boxW, h: boxH };
  y1 += boxH + 16;
  const n_support = { x: s1x, y: y1, w: boxW, h: boxH };
  y1 += boxH + 16;
  const n_text = { x: s1x, y: y1, w: boxW, h: boxH };
  y1 += boxH + 20;
  const n_owl = { x: s1x, y: y1, w: boxW, h: 78 };
  y1 += 78 + 16;
  const n_init = { x: s1x, y: y1, w: boxW, h: boxH };

  // bottom encoders (2-col)
  const encY = (pad + 58) + (stageH - 58) - 170;
  const halfW = Math.floor((boxW - 14) / 2);
  const n_clip_img = { x: s1x, y: encY, w: halfW, h: 70 };
  const n_clip_txt = { x: s1x + halfW + 14, y: encY, w: halfW, h: 70 };
  const n_proto = { x: s1x, y: encY + 84, w: halfW, h: 66 };
  const n_textemb = { x: s1x + halfW + 14, y: encY + 84, w: halfW, h: 66 };

  // --- Stage 2 positions (top loop + fusion + threshold + out)
  const s2x = stageX[1] + 17;
  const s2y0 = paneTop;

  const n_crop = { x: s2x, y: s2y0, w: boxW, h: 78 };
  const n_fusion = { x: s2x, y: s2y0 + 98, w: boxW, h: 88 };
  const n_thresh = { x: s2x, y: s2y0 + 206, w: boxW, h: 64 };
  const n_filt = { x: s2x, y: s2y0 + 286, w: boxW, h: 70 };

  // --- Stage 3 positions (SAM encoder + loop container + selection)
  const s3x = stageX[2] + 17;
  const s3y0 = paneTop;

  const n_sam_enc = { x: s3x, y: s3y0, w: boxW, h: 72 };
  const n_img_emb = { x: s3x, y: s3y0 + 88, w: boxW, h: 66 };

  // loop container
  const loopX = s3x;
  const loopY = s3y0 + 170;
  const loopW = boxW;
  const loopH = 260;

  // inside loop (2 columns)
  const colW = Math.floor((loopW - 18) / 2);
  const inPad = 12;
  const a = { x: loopX + inPad, y: loopY + 58, w: colW - 6, h: 64 }; // prompt encoder
  const b = { x: loopX + inPad + colW, y: loopY + 58, w: colW - 6, h: 64 }; // mask decoder
  const c = { x: loopX + inPad, y: loopY + 132, w: loopW - inPad * 2, h: 70 }; // candidate masks

  const n_select = { x: s3x, y: loopY + loopH + 18, w: boxW, h: 72 };
  const n_best = { x: s3x, y: loopY + loopH + 106, w: boxW, h: 66 };

  // --- Stage 4 positions (aggregation + final + eval + miou)
  const s4x = stageX[3] + 17;
  const s4y0 = paneTop + 14;

  const n_agg = { x: s4x, y: s4y0, w: boxW, h: 80 };
  const n_pred = { x: s4x, y: s4y0 + 100, w: boxW, h: 78 };
  const n_gt = { x: s4x, y: s4y0 + 192, w: boxW, h: 70 };
  const n_iou = { x: s4x, y: s4y0 + 280, w: boxW, h: 70 };
  const n_miou = { x: s4x, y: s4y0 + 366, w: boxW, h: 60 };

  // Nodes SVG
  const nodes = [
    // Stage 1
    nodeBox("query_image", n_query.x, n_query.y, n_query.w, n_query.h, "Query Image (N-shot target)", "data", iconImage(0, 0)),
    nodeBox("support_set", n_support.x, n_support.y, n_support.w, n_support.h, "Support Set (K-shot Images & Masks)", "data", iconStack(0, 0)),
    nodeBox("class_text_prompt", n_text.x, n_text.y, n_text.w, n_text.h, 'Class Text Prompt: "a photo of a [class_name]"', "data", iconBubble(0, 0)),
    nodeBox("owlvit_detector", n_owl.x, n_owl.y, n_owl.w, n_owl.h, "OWL-ViT Detector (Open-Vocabulary Detection)", "model"),
    nodeBox("init_boxes_scores", n_init.x, n_init.y, n_init.w, n_init.h, "Initial Bounding Boxes & Scores", "data", `<g transform="translate(0,0)">${iconMask(0,0)}</g>`),

    nodeBox("clip_image_encoder_masked", n_clip_img.x, n_clip_img.y, n_clip_img.w, n_clip_img.h, "CLIP Image Encoder (Masked Inputs)", "model"),
    nodeBox("clip_text_encoder", n_clip_txt.x, n_clip_txt.y, n_clip_txt.w, n_clip_txt.h, "CLIP Text Encoder", "model"),
    nodeBox("support_prototypes", n_proto.x, n_proto.y, n_proto.w, n_proto.h, "Support Prototypes (Avg Embedding)", "embed", iconCylinder(0, 0, "#DDEAFE")),
    nodeBox("class_text_embedding", n_textemb.x, n_textemb.y, n_textemb.w, n_textemb.h, "Class Text Embedding", "embed", iconCylinder(0, 0, "#FFE7D2")),

    // Stage 2
    nodeBox("crop_encode_loop", n_crop.x, n_crop.y, n_crop.w, n_crop.h, "Crop & Encode Loop (per Box)", "func"),
    nodeBox("fusion_function", n_fusion.x, n_fusion.y, n_fusion.w, n_fusion.h, "Similarity & Score Fusion Function (cos sim + weighted sum)", "func"),
    nodeBox("threshold_filtering", n_thresh.x, n_thresh.y, n_thresh.w, n_thresh.h, "Threshold Filtering (τ = μ + σ)", "func"),
    nodeBox("filtered_boxes", n_filt.x, n_filt.y, n_filt.w, n_filt.h, "Filtered High-Confidence Boxes", "data"),

    // Stage 3
    nodeBox("sam_image_encoder", n_sam_enc.x, n_sam_enc.y, n_sam_enc.w, n_sam_enc.h, "SAM Image Encoder", "model"),
    nodeBox("image_embeddings", n_img_emb.x, n_img_emb.y, n_img_emb.w, n_img_emb.h, "Image Embeddings", "embed", iconCylinder(0, 0, "#DFF5E8")),

    // loop container + inside
    `
<g id="iterative_loop">
  <rect x="${loopX}" y="${loopY}" width="${loopW}" height="${loopH}" rx="18" fill="#FFFFFF" opacity="0.55" stroke="#7AD3A5" stroke-width="2"/>
  <text x="${loopX+16}" y="${loopY+34}" font-family="Arial" font-size="14" font-weight="800" fill="#14532d">
    Iterative SAM Refinement Loop
  </text>
</g>
`.trim(),
    nodeBox("sam_prompt_encoder", a.x, a.y, a.w, a.h, "SAM Prompt Encoder (Box / Mask)", "model"),
    nodeBox("sam_mask_decoder", b.x, b.y, b.w, b.h, "SAM Mask Decoder", "model"),
    nodeBox("candidate_masks", c.x, c.y, c.w, c.h, "Candidate Masks (Post-Refinement)", "data", iconMask(0, 0)),
    nodeBox("final_mask_selection", n_select.x, n_select.y, n_select.w, n_select.h, "Final Mask Selection (Feature Similarity)", "func"),
    nodeBox("selected_best_masks", n_best.x, n_best.y, n_best.w, n_best.h, "Selected Best Masks", "data", iconMask(0, 0)),

    // Stage 4
    nodeBox("mask_aggregation", n_agg.x, n_agg.y, n_agg.w, n_agg.h, "Mask Aggregation (Union)", "func", iconCylinder(0, 0, "#EFEAFF")),
    nodeBox("final_prediction_mask", n_pred.x, n_pred.y, n_pred.w, n_pred.h, "Final Prediction Mask", "data", iconMask(0, 0)),
    nodeBox("ground_truth_query_mask", n_gt.x, n_gt.y, n_gt.w, n_gt.h, "Ground Truth Query Mask", "data", iconMask(0, 0)),
    nodeBox("iou_metric", n_iou.x, n_iou.y, n_iou.w, n_iou.h, "IoU Evaluation Metric", "func"),
    nodeBox("miou_score", n_miou.x, n_miou.y, n_miou.w, n_miou.h, "mIoU Score", "data"),
  ].join("\n");

  // Edges SVG (좌표는 "박스 중심/측면" 기준으로 고정)
  const cx = (b: any) => b.x + b.w / 2;
  const cy = (b: any) => b.y + b.h / 2;
  const right = (b: any) => ({ x: b.x + b.w, y: cy(b) });
  const left = (b: any) => ({ x: b.x, y: cy(b) });

  const arrows = [
    // Stage 1 -> OWL
    elbowArrow(cx(n_query), n_query.y + n_query.h, cx(n_owl), n_owl.y, undefined),
    elbowArrow(cx(n_text), n_text.y + n_text.h, cx(n_owl), n_owl.y, undefined),
    elbowArrow(cx(n_owl), n_owl.y + n_owl.h, cx(n_init), n_init.y, undefined),

    // Support/Text -> CLIP encoders
    elbowArrow(cx(n_support), n_support.y + n_support.h, cx(n_clip_img), n_clip_img.y, undefined, true),
    elbowArrow(cx(n_text), n_text.y + n_text.h, cx(n_clip_txt), n_clip_txt.y, undefined, true),
    elbowArrow(cx(n_clip_img), n_clip_img.y + n_clip_img.h, cx(n_proto), n_proto.y, undefined),
    elbowArrow(cx(n_clip_txt), n_clip_txt.y + n_clip_txt.h, cx(n_textemb), n_textemb.y, undefined),

    // Stage 1 -> Stage 2
    elbowArrow(right(n_init).x, right(n_init).y, left(n_crop).x, left(n_crop).y, "boxes + scores"),
    elbowArrow(right(n_query).x, right(n_query).y, left(n_crop).x, left(n_crop).y, "query image", true),
    elbowArrow(right(n_proto).x, right(n_proto).y, left(n_fusion).x, left(n_fusion).y, "support proto", true),
    elbowArrow(right(n_textemb).x, right(n_textemb).y, left(n_fusion).x, left(n_fusion).y, "text emb", true),

    // Stage 2 flow
    elbowArrow(cx(n_crop), n_crop.y + n_crop.h, cx(n_fusion), n_fusion.y, "crop emb"),
    elbowArrow(cx(n_fusion), n_fusion.y + n_fusion.h, cx(n_thresh), n_thresh.y, undefined),
    elbowArrow(cx(n_thresh), n_thresh.y + n_thresh.h, cx(n_filt), n_filt.y, undefined),

    // Stage 2 -> Stage 3
    elbowArrow(right(n_filt).x, right(n_filt).y, left(n_sam_enc).x, left(n_sam_enc).y, "filtered boxes"),
    elbowArrow(right(n_query).x, right(n_query).y, left(n_sam_enc).x, left(n_sam_enc).y, "query image", true),

    // Stage 3 encoder
    elbowArrow(cx(n_sam_enc), n_sam_enc.y + n_sam_enc.h, cx(n_img_emb), n_img_emb.y, undefined),

    // Into loop
    elbowArrow(cx(n_img_emb), n_img_emb.y + n_img_emb.h, cx(b), b.y, "image emb"),
    elbowArrow(right(n_filt).x, right(n_filt).y, left(a).x, left(a).y, "box prompt"),

    // prompt -> decoder -> masks
    elbowArrow(right(a).x, right(a).y, left(b).x, left(b).y, undefined),
    elbowArrow(cx(b), b.y + b.h, cx(c), c.y, undefined),

    // feedback (candidate masks -> prompt encoder)
    curveArrow(c.x + c.w * 0.25, c.y + c.h, a.x + a.w * 0.2, a.y),

    // selection
    elbowArrow(cx(c), c.y + c.h, cx(n_select), n_select.y, undefined),
    elbowArrow(right(n_textemb).x, right(n_textemb).y, left(n_select).x, left(n_select).y, "class text emb", true),
    elbowArrow(cx(n_select), n_select.y + n_select.h, cx(n_best), n_best.y, undefined),

    // Stage 3 -> Stage 4
    elbowArrow(right(n_best).x, right(n_best).y, left(n_agg).x, left(n_agg).y, "best masks"),

    // Stage 4 flow
    elbowArrow(cx(n_agg), n_agg.y + n_agg.h, cx(n_pred), n_pred.y, undefined),
    elbowArrow(cx(n_pred), n_pred.y + n_pred.h, cx(n_iou), n_iou.y, undefined),
    elbowArrow(cx(n_gt), n_gt.y + n_gt.h, cx(n_iou), n_iou.y, undefined),
    elbowArrow(cx(n_iou), n_iou.y + n_iou.h, cx(n_miou), n_miou.y, undefined),
  ].join("\n");

  const titleSvg = `
<text x="${W/2}" y="${38}" text-anchor="middle"
      font-family="Arial" font-size="24" font-weight="900" fill="#0f172a">
  ${esc(title)}
</text>
<line x1="${pad}" y1="${52}" x2="${W-pad}" y2="${52}" stroke="#0f172a" opacity="0.15" stroke-width="2"/>
`.trim();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${markerDefs()}
  <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>
  ${titleSvg}
  ${panels}
  ${arrows}
  ${nodes}
</svg>`;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const prompt = String(form.get("prompt") ?? "").trim();

    // 프롬프트가 없어도 템플릿은 만들 수 있게 (UI 안 건드리기)
    const title =
      prompt && prompt.length > 0
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

