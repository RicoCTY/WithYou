import { createRequire } from "node:module";
import { config } from "./config.js";
import { ensureModels, senseVoiceModel, senseVoiceTokens } from "./models.js";

const require = createRequire(import.meta.url);

type Wave = { samples: Float32Array; sampleRate: number };
type Stream = { acceptWaveform: (wave: Wave) => void };
type Recognizer = {
  createStream: () => Stream;
  decodeAsync: (stream: Stream) => Promise<{ text?: string }>;
};

type Sherpa = {
  OfflineRecognizer: new (config: unknown) => Recognizer;
};

let recognizer: Recognizer | null = null;

export async function loadStt(): Promise<void> {
  if (recognizer) return;
  await ensureModels();
  const sherpa = require("sherpa-onnx-node") as Sherpa;
  recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model: senseVoiceModel,
        language: config.sttLanguage,
        useInverseTextNormalization: 1,
      },
      tokens: senseVoiceTokens,
      numThreads: 2,
      provider: "cpu",
      debug: 0,
    },
  });
  console.log("SenseVoice ready");
}

export async function transcribe(samples: Float32Array): Promise<string> {
  if (!recognizer) throw new Error("SenseVoice is not loaded");
  const stream = recognizer.createStream();
  stream.acceptWaveform({ samples, sampleRate: 16000 });
  const result = await recognizer.decodeAsync(stream);
  return (result.text ?? "").trim();
}

export function pcm48StereoToMono16k(pcm: Buffer): Float32Array {
  const frames = Math.floor(pcm.length / 4);
  const groups = Math.floor(frames / 3);
  const out = new Float32Array(groups);
  for (let i = 0; i < groups; i++) {
    let sum = 0;
    for (let j = 0; j < 3; j++) {
      const offset = (i * 3 + j) * 4;
      const left = pcm.readInt16LE(offset);
      const right = pcm.readInt16LE(offset + 2);
      sum += (left + right) / 2;
    }
    out[i] = sum / 3 / 32768;
  }
  return out;
}
