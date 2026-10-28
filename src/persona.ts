import { config } from "./config.js";

export const PERSONA = config.persona;

export function userPrompt(options: {
  speakerName: string;
  username: string;
  request: string;
  memory: string;
  alsoHeard: string;
}): string {
  const recent = [options.memory, options.alsoHeard].filter(Boolean).join("\n");
  const background = recent ? `${config.memoryHint}\n${recent}\n` : "";
  return `${background}${options.speakerName}（@${options.username}）剛剛講：${options.request}\n${config.replyInstruction}`;
}

export function spokenLine(text: string): string {
  const cleaned = text
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[*_`#>\[\]\(\)（）]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!cleaned) return "";
  return cleaned;
}
