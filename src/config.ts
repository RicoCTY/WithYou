import { readFileSync } from "node:fs";
import path from "node:path";
import "dotenv/config";

type CharacterFile = {
  botName: string;
  speech: { language: string; replyInstruction: string; memoryHint: string };
  voice: { model: string; voiceId: string; tone: string };
  messages: { join: string; leave: string; needVoice: string; joinFailed: string };
  persona: string;
};

function optional(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function required(name: string): string {
  const value = optional(name);
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

function loadCharacter(): CharacterFile {
  const file = path.resolve(process.cwd(), optional("CHARACTER_FILE") || "config/character.json");
  try {
    return JSON.parse(readFileSync(file, "utf8")) as CharacterFile;
  } catch {
    throw new Error(`Cannot read ${file}. Copy config/character.example.json to config/character.json.`);
  }
}

const character = loadCharacter();

export const config = {
  discordToken: optional("DISCORD_TOKEN"),
  discordClientId: optional("DISCORD_CLIENT_ID"),
  discordGuildId: optional("DISCORD_GUILD_ID"),
  voiceChannelId: optional("VOICE_CHANNEL_ID"),
  botName: character.botName,
  sttLanguage: character.speech.language,
  replyInstruction: character.speech.replyInstruction,
  memoryHint: character.speech.memoryHint,
  joinReply: character.messages.join,
  leaveReply: character.messages.leave,
  needVoiceReply: character.messages.needVoice,
  joinFailedReply: character.messages.joinFailed,
  persona: character.persona,
  fishApiKey: optional("FISH_API_KEY"),
  fishVoiceId: optional("FISH_VOICE_ID") || character.voice.voiceId,
  fishModel: optional("FISH_MODEL") || character.voice.model,
  fishTone: character.voice.tone,
  minimaxApiKey: optional("MINIMAX_API_KEY"),
  minimaxModel: optional("MINIMAX_MODEL") || "MiniMax-M3",
  minimaxBaseUrl: optional("MINIMAX_BASE_URL") || "https://api.minimaxi.com/v1",
};

export function requireFishKey(): string {
  return config.fishApiKey || required("FISH_API_KEY");
}

const HOMOGLYPHS: Record<string, string> = {
  "\u0410": "A",
  "\u0412": "B",
  "\u0415": "E",
  "\u041a": "K",
  "\u041c": "M",
  "\u041d": "H",
  "\u041e": "O",
  "\u0420": "P",
  "\u0421": "C",
  "\u0422": "T",
  "\u0425": "X",
  "\u0430": "a",
  "\u0435": "e",
  "\u043e": "o",
  "\u0440": "p",
  "\u0441": "c",
  "\u0443": "y",
  "\u0445": "x",
  "\u0456": "i",
  "\u0406": "I",
};

export function requireMinimaxKey(): string {
  const raw = config.minimaxApiKey || required("MINIMAX_API_KEY");
  const key = [...raw].map((char) => HOMOGLYPHS[char] ?? char).join("").trim();
  if ([...key].some((char) => char.charCodeAt(0) > 255)) {
    throw new Error("MINIMAX_API_KEY contains a non-English character. Copy the key again as plain text.");
  }
  return key;
}
