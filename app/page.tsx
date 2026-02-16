"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type ConvertStatus = "idle" | "uploading" | "processing" | "done" | "error";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function useToast() {
  const [toasts, setToasts] = useState<
    Array<{ id: string; title: string; message?: string; kind: "success" | "error" | "info" }>
  >([]);

  const push = (t: Omit<(typeof toasts)[number], "id">) => {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setToasts((p) => [...p, { ...t, id }]);
    window.setTimeout(() => {
      setToasts((p) => p.filter((x) => x.id !== id));
    }, 3800);
  };

  const Toasts = () => (
    <div className="fixed right-4 top-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "rounded-2xl border px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl",
            "bg-zinc-950/70",
            t.kind === "success" && "border-emerald-500/30",
            t.kind === "error" && "border-rose-500/30",
            t.kind === "info" && "border-cyan-500/25"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-100">{t.title}</div>
              {t.message ? <div className="mt-0.5 text-xs text-zinc-300/90">{t.message}</div> : null}
            </div>
            <button
              className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
              aria-label="Close toast"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  return { push, Toasts };
}

function StepPill({ active, label }: { active: boolean; label: string }) {
  return (
    <div
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium",
        active
          ? "border-cyan-400/35 bg-cyan-500/10 text-cyan-200"
          : "border-white/10 bg-white/5 text-zinc-300"
      )}
    >
      {label}
    </div>
  );
}

function Spinner() {
  return (
    <div className="relative h-4 w-4">
      <div className="absolute inset-0 animate-spin rounded-full border-2 border-white/15 border-t-cyan-300/80" />
    </div>
  );
}

function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-white/10 bg-white/5",
        className
      )}
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <style jsx global>{`
        @keyframes shimmer {
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
      <div className="h-full w-full opacity-0">.</div>
    </div>
  );
}

export default function Page() {
  // Core inputs
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);

  // Options (extend as you need)
  const [stylePreset, setStylePreset] = useState<"clean" | "minimal" | "poster">("clean");
  const [detail, setDetail] = useState(70); // 0..100
  const [layout, setLayout] = useState<"auto" | "left-to-right" | "top-down">("auto");

  // Result
  const [status, setStatus] = useState<ConvertStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [svgText, setSvgText] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview");

  // Preview controls
  const [zoom, setZoom] = useState(1);
  const [checkerBg, setCheckerBg] = useState(true);
  const previewWrapRef = useRef<HTMLDivElement | null>(null);

  // Download URL
  const svgBlobUrl = useMemo(() => {
    if (!svgText) return "";
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    return URL.createObjectURL(blob);
  }, [svgText]);

  useEffect(() => {
    return () => {
      if (svgBlobUrl) URL.revokeObjectURL(svgBlobUrl);
    };
  }, [svgBlobUrl]);

  const { push, Toasts } = useToast();

  const canConvert = useMemo(() => {
    const hasPrompt = prompt.trim().length > 0;
    const hasFile = !!file;
    return hasPrompt || hasFile;
  }, [prompt, file]);

  const statusLabel = useMemo(() => {
    switch (status) {
      case "idle":
        return "Ready";
      case "uploading":
        return "Uploading…";
      case "processing":
        return "Generating SVG…";
      case "done":
        return "Complete";
      case "error":
        return "Error";
    }
  }, [status]);

  const statusHelp = useMemo(() => {
    switch (status) {
      case "idle":
        return "Provide a prompt and/or a file to generate an editable SVG diagram.";
      case "uploading":
        return "Sending inputs to the converter.";
      case "processing":
        return "Model is composing a clean, publication-ready diagram.";
      case "done":
        return "Preview the SVG and export it.";
      case "error":
        return "Fix the issue and try again.";
    }
  }, [status]);

  function onPickFile(f: File | null) {
    setFile(f);
    setErrorMsg(null);
    if (f) push({ kind: "info", title: "File attached", message: `${f.name} · ${formatBytes(f.size)}` });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onPickFile(dropped);
  }

  function fitToView() {
    // naive fit: reset zoom, scroll top-left
    setZoom(1);
    const el = previewWrapRef.current;
    if (el) el.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }

  async function handleConvert() {
    if (!canConvert) return;

    setStatus("uploading");
    setErrorMsg(null);

    try {
      const fd = new FormData();
      if (prompt.trim()) fd.append("prompt", prompt.trim());
      if (file) fd.append("file", file);

      // Optional knobs (your /api/convert can ignore if not implemented yet)
      fd.append("stylePreset", stylePreset);
      fd.append("detail", String(detail));
      fd.append("layout", layout);

      // Upload phase
      const res = await fetch("/api/convert", {
        method: "POST",
        body: fd,
      });

      setStatus("processing");

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `Request failed (${res.status})`);
      }

      const svg = await res.text();
      if (!svg || !svg.includes("<svg")) {
        throw new Error("Converter did not return a valid SVG string.");
      }

      setSvgText(svg);
      setActiveTab("preview");
      setStatus("done");
      push({ kind: "success", title: "SVG generated", message: "Preview is ready. You can download the .svg file." });
    } catch (err: any) {
      const msg = err?.message || "Unknown error";
      setErrorMsg(msg);
      setStatus("error");
      push({ kind: "error", title: "Conversion failed", message: msg });
    }
  }

  function handleDownload() {
    if (!svgBlobUrl) return;
    const a = document.createElement("a");
    a.href = svgBlobUrl;
    a.download = `paper2figure_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.svg`;
    a.click();
  }

  return (
    <div className="min-h-screen bg-[#070A0F] text-zinc-100">
      <Toasts />

      {/* Subtle background: grid + glow (academic, not too gamey) */}
      <div
        className="pointer-events-none fixed inset-0 opacity-90"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(600px 300px at 20% 10%, rgba(34,211,238,0.12), transparent 60%), radial-gradient(500px 250px at 80% 0%, rgba(34,211,238,0.08), transparent 55%), linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "auto, auto, 28px 28px, 28px 28px",
          backgroundPosition: "center, center, 0 0, 0 0",
        }}
      />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070A0F]/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl border border-cyan-400/25 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.06)]">
              <span className="text-sm font-bold text-cyan-200">P2F</span>
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight text-zinc-100">paper2figure</div>
              <div className="text-xs text-zinc-400">Generate clean, editable SVG figures from papers & prompts</div>
            </div>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <StepPill active={status === "idle" || status === "error"} label="1 · Input" />
            <StepPill active={status === "uploading"} label="2 · Upload" />
            <StepPill active={status === "processing"} label="3 · Generate" />
            <StepPill active={status === "done"} label="4 · Export" />
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:block text-right">
              <div className="text-xs font-medium text-zinc-200">{statusLabel}</div>
              <div className="text-[11px] text-zinc-400">{statusHelp}</div>
            </div>
            <button
              onClick={handleConvert}
              disabled={!canConvert || status === "uploading" || status === "processing"}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold",
                "border border-cyan-400/30 bg-cyan-500/12 text-cyan-100",
                "shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_12px_30px_rgba(0,0,0,0.35)]",
                "hover:bg-cyan-500/16 hover:border-cyan-300/40",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              {(status === "uploading" || status === "processing") ? <Spinner /> : null}
              Convert
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr]">
          {/* Left: Input */}
          <section className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_50px_rgba(0,0,0,0.35)]">
              <div className="mb-4">
                <div className="text-sm font-semibold text-zinc-100">Inputs</div>
                <div className="mt-1 text-xs leading-relaxed text-zinc-400">
                  Provide a paper (PDF/image/text) and/or a prompt. The converter will produce an editable, publication-ready SVG.
                </div>
              </div>

              {/* File dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={onDrop}
                className={cn(
                  "group relative rounded-2xl border border-white/10 bg-white/5 p-4",
                  "transition hover:border-cyan-400/25 hover:bg-cyan-500/5"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-zinc-200">Upload file</div>
                    <div className="mt-0.5 text-[11px] text-zinc-400">
                      PDF, image, or text. Drag & drop here, or choose a file.
                    </div>
                  </div>
                  <label className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10">
                    Browse
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,image/*,.txt,.md"
                      onChange={(e) => onPickFile(e.target.files?.[0] || null)}
                    />
                  </label>
                </div>

                <div className="mt-3 rounded-xl border border-white/10 bg-[#070A0F]/40 p-3">
                  {file ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-zinc-100">{file.name}</div>
                        <div className="mt-0.5 text-[11px] text-zinc-400">
                          {file.type || "unknown"} · {formatBytes(file.size)}
                        </div>
                      </div>
                      <button
                        onClick={() => onPickFile(null)}
                        className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                        aria-label="Remove file"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="text-[11px] text-zinc-500">
                      No file selected. (Optional)
                    </div>
                  )}
                </div>
              </div>

              {/* Prompt */}
              <div className="mt-5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-200">Prompt</label>
                  <div className="text-[11px] text-zinc-500">
                    {prompt.trim().length}/1200
                  </div>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g., 'Draw a clean pipeline diagram of CLIP training: image encoder + text encoder -> contrastive loss. Include projection heads, normalized embeddings, and retrieval use case.'"
                  className={cn(
                    "mt-2 h-36 w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3",
                    "text-sm text-zinc-100 placeholder:text-zinc-500",
                    "outline-none focus:border-cyan-300/35 focus:ring-2 focus:ring-cyan-400/10"
                  )}
                />
                <div className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                  Tip: mention **layout direction**, **labels**, and **style** (minimal / poster / clean) to get more consistent figures.
                </div>
              </div>
            </div>

            {/* Options */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_50px_rgba(0,0,0,0.35)]">
              <div className="mb-4">
                <div className="text-sm font-semibold text-zinc-100">Options</div>
                <div className="mt-1 text-xs text-zinc-400">Quality knobs (safe defaults). Your API can ignore these for now.</div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-zinc-200">Preset</div>
                  <div className="mt-2 flex gap-2">
                    {(["clean", "minimal", "poster"] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setStylePreset(p)}
                        className={cn(
                          "flex-1 rounded-xl border px-3 py-2 text-xs font-semibold capitalize",
                          stylePreset === p
                            ? "border-cyan-400/35 bg-cyan-500/10 text-cyan-100"
                            : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/8"
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-zinc-200">Layout</div>
                  <div className="mt-2 flex gap-2">
                    {(
                      [
                        { key: "auto", label: "Auto" },
                        { key: "left-to-right", label: "L→R" },
                        { key: "top-down", label: "Top↓" },
                      ] as const
                    ).map((x) => (
                      <button
                        key={x.key}
                        onClick={() => setLayout(x.key)}
                        className={cn(
                          "flex-1 rounded-xl border px-3 py-2 text-xs font-semibold",
                          layout === x.key
                            ? "border-cyan-400/35 bg-cyan-500/10 text-cyan-100"
                            : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/8"
                        )}
                      >
                        {x.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-zinc-200">Detail</div>
                    <div className="text-[11px] text-zinc-500">{detail}/100</div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={detail}
                    onChange={(e) => setDetail(Number(e.target.value))}
                    className="mt-2 w-full accent-cyan-300"
                  />
                  <div className="mt-1 text-[11px] text-zinc-500">
                    Higher detail may add more labels/structure. Keep moderate for clean slides.
                  </div>
                </div>
              </div>

              {/* Convert action hint */}
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 h-2 w-2 rounded-full bg-cyan-300/80 shadow-[0_0_18px_rgba(34,211,238,0.35)]" />
                  <div className="text-[11px] leading-relaxed text-zinc-400">
                    Aim for <span className="text-zinc-200">editable figures</span>: clear hierarchy, consistent spacing, and concise labels.
                    If the model output is busy, switch to <span className="text-zinc-200">Minimal</span> and reduce detail.
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Right: Output */}
          <section className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_50px_rgba(0,0,0,0.35)]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-zinc-100">Result</div>
                  <div className="mt-1 text-xs text-zinc-400">
                    Preview the SVG, inspect the markup, then export.
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setActiveTab("preview")}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-xs font-semibold",
                      activeTab === "preview"
                        ? "border-cyan-400/35 bg-cyan-500/10 text-cyan-100"
                        : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/8"
                    )}
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => setActiveTab("code")}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-xs font-semibold",
                      activeTab === "code"
                        ? "border-cyan-400/35 bg-cyan-500/10 text-cyan-100"
                        : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/8"
                    )}
                    disabled={!svgText}
                  >
                    SVG Code
                  </button>

                  <div className="mx-1 hidden h-7 w-px bg-white/10 sm:block" />

                  <button
                    onClick={() => setCheckerBg((v) => !v)}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/8"
                    disabled={!svgText}
                    title="Toggle background"
                  >
                    BG
                  </button>

                  <button
                    onClick={() => setZoom((z) => clamp(Number((z - 0.1).toFixed(2)), 0.4, 2.5))}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/8"
                    disabled={!svgText}
                    title="Zoom out"
                  >
                    −
                  </button>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-300">
                    {Math.round(zoom * 100)}%
                  </div>
                  <button
                    onClick={() => setZoom((z) => clamp(Number((z + 0.1).toFixed(2)), 0.4, 2.5))}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/8"
                    disabled={!svgText}
                    title="Zoom in"
                  >
                    +
                  </button>

                  <button
                    onClick={fitToView}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/8"
                    disabled={!svgText}
                    title="Fit"
                  >
                    Fit
                  </button>

                  <button
                    onClick={handleDownload}
                    className={cn(
                      "rounded-xl px-3 py-2 text-xs font-semibold",
                      "border border-cyan-400/30 bg-cyan-500/12 text-cyan-100 hover:bg-cyan-500/16",
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                    disabled={!svgText}
                  >
                    Download .svg
                  </button>
                </div>
              </div>

              {/* Status / Error */}
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "h-2 w-2 rounded-full",
                          status === "done" && "bg-emerald-400",
                          status === "error" && "bg-rose-400",
                          (status === "uploading" || status === "processing") && "bg-cyan-300 animate-pulse",
                          status === "idle" && "bg-zinc-500"
                        )}
                      />
                      <div className="text-xs font-semibold text-zinc-200">{statusLabel}</div>
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-400">{statusHelp}</div>
                    {errorMsg ? (
                      <div className="mt-2 text-[11px] text-rose-200/90">
                        {errorMsg}
                      </div>
                    ) : null}
                  </div>

                  {(status === "uploading" || status === "processing") ? (
                    <div className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                      <Spinner />
                      Working…
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Preview Area */}
              <div className="mt-4">
                <div
                  ref={previewWrapRef}
                  className={cn(
                    "relative h-[520px] overflow-auto rounded-2xl border border-white/10",
                    "bg-[#05070B]",
                    checkerBg && "bg-[linear-gradient(45deg,rgba(255,255,255,0.06)_25%,transparent_25%,transparent_75%,rgba(255,255,255,0.06)_75%,rgba(255,255,255,0.06)),linear-gradient(45deg,rgba(255,255,255,0.06)_25%,transparent_25%,transparent_75%,rgba(255,255,255,0.06)_75%,rgba(255,255,255,0.06)] bg-[length:24px_24px] bg-[position:0_0,12px_12px]"
                  )}
                >
                  {/* Loading skeleton */}
                  {(status === "uploading" || status === "processing") && (
                    <div className="absolute inset-0 z-10 grid place-items-center bg-black/30 backdrop-blur-sm">
                      <div className="w-[min(560px,90%)] space-y-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                          <Spinner />
                          Generating diagram…
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <Shimmer className="h-24" />
                          <Shimmer className="h-24" />
                          <Shimmer className="h-24" />
                        </div>
                        <Shimmer className="h-56" />
                        <div className="text-xs text-zinc-400">
                          Tip: If output looks cluttered, try <span className="text-zinc-200">Minimal</span> preset.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {status !== "uploading" && status !== "processing" && !svgText && (
                    <div className="grid h-full place-items-center p-6">
                      <div className="max-w-md text-center">
                        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-cyan-400/25 bg-cyan-500/10">
                          <span className="text-cyan-200">◇</span>
                        </div>
                        <div className="text-sm font-semibold text-zinc-100">No SVG yet</div>
                        <div className="mt-1 text-xs leading-relaxed text-zinc-400">
                          Add a prompt and/or upload a file, then click <span className="text-zinc-200">Convert</span>.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Content */}
                  {svgText && activeTab === "preview" && (
                    <div className="p-6">
                      <div
                        className="origin-top-left"
                        style={{ transform: `scale(${zoom})` }}
                        // The SVG is trusted from your own API; if untrusted, sanitize!
                        dangerouslySetInnerHTML={{ __html: svgText }}
                      />
                    </div>
                  )}

                  {svgText && activeTab === "code" && (
                    <pre className="h-full whitespace-pre-wrap break-words p-5 text-[11px] leading-relaxed text-zinc-200">
                      {svgText}
                    </pre>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
                  <div>
                    {svgText ? (
                      <>
                        Output size: <span className="text-zinc-300">{formatBytes(new Blob([svgText]).size)}</span>
                      </>
                    ) : (
                      <>Output will appear here.</>
                    )}
                  </div>
                  <div className="hidden sm:block">
                    Safety: Rendering SVG via <span className="text-zinc-300">dangerouslySetInnerHTML</span> — sanitize if you expose public uploads.
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom hint */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-zinc-100">Demo-ready polish</div>
                  <div className="mt-1 text-xs leading-relaxed text-zinc-400">
                    This layout is designed for live demos: clear flow, strong hierarchy, and a premium preview/export panel.
                  </div>
                </div>
                <div className="text-xs text-zinc-500">
                  Next: add history, versioning, and templates.
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-white/10 py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <div>© {new Date().getFullYear()} paper2figure</div>
          <div className="flex flex-wrap gap-3">
            <span className="text-zinc-400">Academic-grade diagrams</span>
            <span className="opacity-60">•</span>
            <span>Next.js App Router</span>
            <span className="opacity-60">•</span>
            <span>SVG export</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
