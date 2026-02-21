// lib/storage.ts
import path from "path";
import os from "os";
import { promises as fs } from "fs";

export type ArtifactPaths = {
  dir: string;
  promptTxt: string;
  imagePng: string;
  imageSvg: string;
};

export async function getArtifactPaths(): Promise<ArtifactPaths> {
  // =========================================================
  // #0. Internal storage: overwrite on every run
  // - Use OS temp dir to avoid permission issues on deployments
  // =========================================================
  const dir = path.join(os.tmpdir(), "paper2figure");
  await fs.mkdir(dir, { recursive: true });

  return {
    dir,
    promptTxt: path.join(dir, "prompt.txt"),
    imagePng: path.join(dir, "image.png"),
    imageSvg: path.join(dir, "image.svg"),
  };
}

export async function writeOverwrite(filePath: string, data: string | Buffer) {
  // =========================================================
  // #0. Always overwrite (no accumulation)
  // =========================================================
  await fs.writeFile(filePath, data);
}