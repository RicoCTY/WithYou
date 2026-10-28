export type Heard = {
  userId: string;
  name: string;
  username: string;
  text: string;
  seconds: number;
};

export type MemoryLine = {
  name: string;
  username: string;
  text: string;
  at: number;
};

const MEMORY_LIMIT = 24;
const MEMORY_MS = 3 * 60 * 60 * 1000;

export function cleanTranscript(text: string): string {
  return text
    .replace(/<\|[^|]*\|>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isRealSpeech(text: string): boolean {
  const compact = text.replace(/\s/g, "");
  if (!compact || /^[\p{P}\p{S}.。,，!！?？]+$/u.test(compact)) return false;
  const han = text.match(/\p{Script=Han}/gu);
  return (han?.length ?? 0) >= 2;
}

function han(text: string): string {
  return (text.match(/\p{Script=Han}/gu) ?? []).join("");
}

export function isEcho(reply: string, source: string): boolean {
  const spoken = han(reply);
  const heard = han(source);
  if (spoken.length < 2 || heard.length < 2) return false;
  if (spoken === heard) return true;
  const shorter = spoken.length <= heard.length ? spoken : heard;
  const longer = spoken.length <= heard.length ? heard : spoken;
  return longer.length - shorter.length <= 2 && longer.includes(shorter);
}

export function tooSimilar(a: string, b: string): boolean {
  const x = (a.match(/\p{Script=Han}/gu) ?? []).join("");
  const y = (b.match(/\p{Script=Han}/gu) ?? []).join("");
  if (x.length < 2 || y.length < 2) return false;
  if (x === y) return true;
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return true;
  return false;
}

export function hasVoice(samples: Float32Array): boolean {
  if (samples.length === 0) return false;
  let energy = 0;
  let loud = 0;
  for (const sample of samples) {
    energy += sample * sample;
    if (Math.abs(sample) > 0.02) loud += 1;
  }
  const rms = Math.sqrt(energy / samples.length);
  return rms > 0.015 && loud / samples.length > 0.05;
}

export function completeness(item: Heard): number {
  return item.text.replace(/\s/g, "").length * 1000 + item.seconds;
}

export function chooseUtterance(items: Heard[]): Heard | null {
  const spoken = items.filter((item) => isRealSpeech(item.text));
  if (spoken.length === 0) return null;
  return spoken.reduce((best, item) => (completeness(item) > completeness(best) ? item : best));
}

export function remember(lines: MemoryLine[], line: MemoryLine, now = Date.now()): MemoryLine[] {
  const kept = lines.filter((item) => now - item.at < MEMORY_MS);
  kept.push(line);
  return kept.slice(-MEMORY_LIMIT);
}

export function formatMemory(lines: MemoryLine[], limit = 10): string {
  const recent = lines.slice(-limit);
  if (recent.length === 0) return "";
  return recent.map((line) => `${line.name}：${line.text}`).join("\n");
}
