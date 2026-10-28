import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { rootDir } from "./models.js";

const KEEP = 5;
const TRIGGER = 10;

export function logsDirectory(): string {
  return path.join(rootDir, "logs");
}

export async function saveReplyMp3(audio: Buffer, directory = logsDirectory()): Promise<string> {
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
  await writeFile(file, audio);
  await pruneMp3Logs(directory);
  return file;
}

export async function pruneMp3Logs(directory = logsDirectory()): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const mp3s = names.filter((name) => name.toLowerCase().endsWith(".mp3"));
  if (mp3s.length < TRIGGER) return [];
  const files = await Promise.all(
    mp3s.map(async (name) => {
      const file = path.join(directory, name);
      const info = await stat(file);
      return { file, mtimeMs: info.mtimeMs };
    }),
  );
  files.sort((a, b) => a.mtimeMs - b.mtimeMs || a.file.localeCompare(b.file));
  const removed: string[] = [];
  for (const item of files.slice(0, files.length - KEEP)) {
    await unlink(item.file);
    removed.push(item.file);
  }
  if (removed.length > 0) console.log(`Removed ${removed.length} old recordings, ${KEEP} mp3 files kept`);
  return removed;
}
