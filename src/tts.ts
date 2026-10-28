import { config, requireFishKey } from "./config.js";

export async function synthesize(text: string, signal: AbortSignal): Promise<Buffer> {
  const direction = config.fishTone;
  const response = await fetch("https://api.fish.audio/v1/tts", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${requireFishKey()}`,
      "Content-Type": "application/json",
      model: config.fishModel,
    },
    body: JSON.stringify({
      text: `${direction} ${text}`,
      reference_id: config.fishVoiceId,
      format: "mp3",
      latency: "low",
      chunk_length: 100,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Fish Audio ${response.status}: ${detail.slice(0, 300)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
