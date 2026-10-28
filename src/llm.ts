import { config, requireMinimaxKey } from "./config.js";
import { isEcho, tooSimilar } from "./floor.js";
import { PERSONA, spokenLine, userPrompt } from "./persona.js";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function loadLlm(): Promise<void> {
  requireMinimaxKey();
  console.log(`MiniMax ${config.minimaxModel}, thinking off`);
}

function memoryMessages(memory: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const line of memory.split("\n")) {
    const match = /^([^：\n]+)：(.+)$/.exec(line.trim());
    if (!match) continue;
    const name = match[1] ?? "";
    const text = match[2]?.trim() ?? "";
    if (!text) continue;
    messages.push(name === config.botName ? { role: "assistant", content: text } : { role: "user", content: `${name}：${text}` });
  }
  return messages;
}

async function postChat(signal: AbortSignal, body: string): Promise<Response> {
  const url = `${config.minimaxBaseUrl.replace(/\/$/, "")}/chat/completions`;
  let lastDetail = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${requireMinimaxKey()}`,
        "Content-Type": "application/json",
      },
      body,
    });
    if (response.ok || (response.status !== 529 && response.status !== 503)) {
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`MiniMax ${response.status}: ${detail.slice(0, 300)}`);
      }
      return response;
    }
    lastDetail = await response.text();
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  throw new Error(`MiniMax 529: ${lastDetail.slice(0, 300)}`);
}

function withoutThoughts(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?think>/gi, "");
}

export async function reply(options: {
  speakerName: string;
  username: string;
  request: string;
  memory: string;
  alsoHeard: string;
  previousLine: string;
  signal: AbortSignal;
  onSentence?: (sentence: string) => void;
}): Promise<string> {
  const body = JSON.stringify({
    model: config.minimaxModel,
    messages: [
      { role: "system", content: PERSONA },
      ...memoryMessages(options.memory),
      { role: "user", content: userPrompt(options) },
    ],
    max_completion_tokens: 64,
    stream: true,
    thinking: { type: "disabled" },
  });
  const response = await postChat(options.signal, body);
  if (!response.body) throw new Error("MiniMax returned an empty response");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let emitted = "";
  const sentences: string[] = [];

  const emitReady = (flush: boolean) => {
    const visible = withoutThoughts(content);
    const pending = visible.slice(emitted.length);
    const boundary = sentences.length === 0 ? /(?<=[。！？!?，,])/ : /(?<=[。！？!?])/;
    const parts = pending.split(boundary);
    if (!flush) {
      emitted = visible.slice(0, visible.length - (parts.at(-1)?.length ?? 0));
    } else {
      emitted = visible;
    }
    if (!flush) parts.pop();
    for (const part of parts) {
      if (sentences.length >= 2) return;
      const line = spokenLine(part);
      if (!line || sentences.some((said) => tooSimilar(said, line)) || isEcho(line, options.previousLine) || isEcho(line, options.request)) continue;
      sentences.push(line);
      options.onSentence?.(line);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let json: { choices?: Array<{ delta?: { content?: string } }> };
      try {
        json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
      } catch {
        continue;
      }
      const delta = json.choices?.[0]?.delta?.content ?? "";
      if (!delta) continue;
      content += delta;
      emitReady(false);
    }
  }
  emitReady(true);
  const joined = sentences.join("") || spokenLine(withoutThoughts(content));
  if (!joined || isEcho(joined, options.request) || isEcho(joined, options.previousLine)) return "";
  return joined;
}
