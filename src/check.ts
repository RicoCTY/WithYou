import path from "node:path";
import { reply, loadLlm } from "./llm.js";
import { saveReplyMp3 } from "./mp3log.js";
import { senseVoiceDir } from "./models.js";
import { chooseUtterance, hasVoice, isRealSpeech, remember, type Heard } from "./floor.js";
import { pcm48StereoToMono16k, loadStt, transcribe } from "./stt.js";
import { synthesize } from "./tts.js";

function heard(name: string, text: string, seconds: number): Heard {
  return { userId: name, name, username: name.toLowerCase(), text, seconds };
}

async function main(): Promise<void> {
  const winner = chooseUtterance([
    heard("Ming", "嗯", 0.5),
    heard("Alex", "聽日去邊度食飯好呀", 2.4),
  ]);
  if (winner?.name !== "Alex") throw new Error(`Expected Alex, got ${winner?.name}`);
  if (chooseUtterance([heard("Rico", "。", 0.4), heard("Rico", "y.", 0.5), heard("Rico", "the.", 0.5)])) {
    throw new Error("Noise should not get a reply");
  }
  if (!isRealSpeech("听唔听到，我讲嘢啊。")) throw new Error("A real sentence should count");
  if (hasVoice(new Float32Array(16000))) throw new Error("Silence should not count as a voice");
  const memory = remember([], { name: "Ming", username: "ming", text: "我肚餓", at: Date.now() });
  if (memory.length !== 1 || memory[0]?.username !== "ming") throw new Error("Memory did not keep the speaker");
  const tone = Buffer.alloc(48000 * 4);
  const samples = pcm48StereoToMono16k(tone);
  if (samples.length !== 16000) throw new Error(`Expected 16000 samples, got ${samples.length}`);
  console.log("Floor and audio checks passed");

  await Promise.all([loadStt(), loadLlm()]);
  const { createRequire } = await import("node:module");
  const sherpa = createRequire(import.meta.url)("sherpa-onnx-node") as {
    readWave: (file: string) => { samples: Float32Array; sampleRate: number };
  };
  const sample = sherpa.readWave(path.join(senseVoiceDir, "test_wavs/yue.wav"));
  if (sample.sampleRate !== 16000) throw new Error(`Unexpected sample rate ${sample.sampleRate}`);
  const cantonese = await transcribe(sample.samples);
  console.log(`Cantonese sample: ${cantonese}`);
  if (!/[\u4e00-\u9fff]/.test(cantonese)) throw new Error("SenseVoice did not transcribe the Cantonese sample");

  const started = Date.now();
  const controller = new AbortController();
  const line = await reply({
    speakerName: "Alex",
    username: "alex",
    request: "你食咗飯未？",
    memory: "- Ming (@ming)：我肚餓",
    alsoHeard: "",
    previousLine: "",
    signal: controller.signal,
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(`MiniMax ${seconds.toFixed(1)}s: ${line}`);
  if (!line) throw new Error("MiniMax returned an empty line");
  if (!/[\u4e00-\u9fff]/.test(line)) throw new Error(`MiniMax did not answer in Chinese: ${line}`);
  const mp3 = await synthesize(line, controller.signal);
  if (mp3.length < 1000) throw new Error("Fish Audio returned a tiny file");
  const header = mp3.subarray(0, 3).toString("utf8");
  const isMp3 = header === "ID3" || mp3[0] === 0xff;
  if (!isMp3) throw new Error("Fish Audio response is not an MP3");
  const file = await saveReplyMp3(mp3);
  console.log(`Wrote ${file} (${mp3.length} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
