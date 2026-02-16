"use client";

import { useState } from "react";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState("");

  function generate() {
    setResult("이 자리에 나중에 SVG가 뜰 예정 🚀");
  }

  return (
    <main style={{ padding: 40, maxWidth: 800, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>
        Paper → SVG Generator (Demo)
      </h1>

      <div style={{ marginTop: 20 }}>
        <input type="file" accept="application/pdf" />
      </div>

      <div style={{ marginTop: 20 }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="프롬프트 입력..."
          rows={5}
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 8,
            border: "1px solid #ccc",
          }}
        />
      </div>

      <button
        onClick={generate}
        style={{
          marginTop: 20,
          padding: "10px 20px",
          borderRadius: 8,
          background: "black",
          color: "white",
          cursor: "pointer",
        }}
      >
        Generate
      </button>

      <div style={{ marginTop: 30 }}>
        {result && (
          <div
            style={{
              padding: 20,
              border: "1px solid #ccc",
              borderRadius: 8,
            }}
          >
            {result}
          </div>
        )}
      </div>
    </main>
  );
}
