import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { remember, type MemoryLine } from "./floor.js";
import { rootDir } from "./models.js";

const file = path.join(rootDir, "logs", "memory.json");

export async function loadMemory(): Promise<MemoryLine[]> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as MemoryLine[];
    if (!Array.isArray(raw)) return [];
    return raw.reduce((lines, item) => {
      if (!item || typeof item.text !== "string" || typeof item.name !== "string") return lines;
      return remember(lines, {
        name: item.name,
        username: typeof item.username === "string" ? item.username : item.name,
        text: item.text,
        at: typeof item.at === "number" ? item.at : Date.now(),
      });
    }, [] as MemoryLine[]);
  } catch {
    return [];
  }
}

export async function saveMemory(lines: MemoryLine[]): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(lines, null, 2));
}
