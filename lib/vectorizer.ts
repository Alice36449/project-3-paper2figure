// lib/vectorizer.ts
import { writeOverwrite } from "./storage";

export async function vectorizePngToSvg(params: {
  pngBuffer: Buffer;
  svgPath: string;
  shapeStacking: "cutouts" | "stacked";
}) {
  const { pngBuffer, svgPath, shapeStacking } = params;

  // =========================================================
  // #4. Vectorizer.AI: PNG -> SVG
  // - Uses Basic Auth: VECTORIZER_API_ID / VECTORIZER_API_SECRET
  // - output.shape_stacking: "cutouts" | "stacked"
  // =========================================================
  const id = process.env.VECTORIZER_API_ID;
  const secret = process.env.VECTORIZER_API_SECRET;
  if (!id || !secret) {
    throw new Error("Missing Vectorizer credentials. Set VECTORIZER_API_ID and VECTORIZER_API_SECRET.");
  }

  const auth = Buffer.from(`${id}:${secret}`).toString("base64");

  const fd = new FormData();
  // image upload (binary)
  fd.append("image", new Blob([pngBuffer], { type: "image/png" }), "image.png");

  // output settings
  fd.append("output.file_format", "svg");
  fd.append("output.shape_stacking", shapeStacking); // cutouts | stacked
  fd.append("output.svg.fixed_size", "true"); // helps keep stable size in editors

  const res = await fetch("https://api.vectorizer.ai/api/v1/vectorize", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
    },
    body: fd,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Vectorizer.AI failed (${res.status}): ${txt.slice(0, 400)}`);
  }

  const svgText = await res.text();
  if (!svgText.includes("<svg")) {
    throw new Error("Vectorizer returned non-SVG response.");
  }

  // Save image.svg (overwrite)
  await writeOverwrite(svgPath, svgText);

  return svgText;
}