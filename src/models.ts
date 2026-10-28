import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const modelsDir = path.join(rootDir, "models");

const SENSEVOICE_DIR = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17";
const SENSEVOICE_URL =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2";

export const senseVoiceDir = path.join(modelsDir, SENSEVOICE_DIR);
export const senseVoiceModel = path.join(senseVoiceDir, "model.int8.onnx");
export const senseVoiceTokens = path.join(senseVoiceDir, "tokens.txt");

async function fileSize(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

function curl(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", ["-L", "--fail", "--retry", "3", "-C", "-", "-o", dest, url], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`curl exited ${code} for ${path.basename(dest)}`));
    });
  });
}

async function download(url: string, dest: string, minBytes: number): Promise<void> {
  if ((await fileSize(dest)) >= minBytes) return;
  await mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  console.log(`Downloading ${path.basename(dest)}`);
  await curl(url, part);
  if ((await fileSize(part)) < minBytes) {
    throw new Error(`Downloaded file is too small: ${path.basename(dest)}`);
  }
  await rename(part, dest);
}

function extractTar(archive: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xjf", archive, "-C", cwd], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited ${code}`));
    });
  });
}

let loading: Promise<void> | null = null;

async function ensureModelsOnce(): Promise<void> {
  await mkdir(modelsDir, { recursive: true });
  if ((await fileSize(senseVoiceModel)) > 1_000_000 && (await fileSize(senseVoiceTokens)) > 100) return;
  const archive = path.join(modelsDir, `${SENSEVOICE_DIR}.tar.bz2`);
  await download(SENSEVOICE_URL, archive, 20_000_000);
  console.log("Extracting SenseVoice");
  await extractTar(archive, modelsDir);
}

export function ensureModels(): Promise<void> {
  loading ??= ensureModelsOnce();
  return loading;
}
