import { createRequire } from "node:module";
import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
} from "@discordjs/voice";
import type { Client, TextBasedChannel, VoiceBasedChannel } from "discord.js";
import { config } from "./config.js";
import { cleanTranscript, completeness, formatMemory, hasVoice, isEcho, isRealSpeech, remember, type Heard, type MemoryLine } from "./floor.js";
import { reply } from "./llm.js";
import { loadMemory, saveMemory } from "./memoryFile.js";
import { Speaker } from "./play.js";
import { pcm48StereoToMono16k, transcribe } from "./stt.js";
import { saveReplyMp3 } from "./mp3log.js";
import { synthesize } from "./tts.js";

const require = createRequire(import.meta.url);
const OpusScript = require("opusscript") as new (rate: number, channels: number) => {
  decode: (packet: Buffer) => Buffer;
  delete?: () => void;
};

type Capture = {
  chunks: Buffer[];
  timer: NodeJS.Timeout | null;
  stream: NodeJS.ReadableStream & { destroy: () => void };
  decoder: { decode: (packet: Buffer) => Buffer; delete?: () => void };
};

type Turn = { signal: AbortSignal };

const MIN_SECONDS = 0.8;
const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

export class VoiceCall {
  private connection: VoiceConnection | null = null;
  private speaker: Speaker | null = null;
  private channel: VoiceBasedChannel | null = null;
  private text: TextBasedChannel | null = null;
  private captures = new Map<string, Capture>();
  private abort = new AbortController();
  private pendingTurns = 0;
  private tail: Promise<void> = Promise.resolve();
  private userLeft = false;
  private activeSpeakers = new Set<string>();
  private inbox: Heard[] = [];
  private memory: MemoryLine[] = [];
  private decideTimer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastSpoken = "";
  private memoryReady: Promise<void> | null = null;

  constructor(private readonly client: Client) {}

  private loadRemembered(): Promise<void> {
    this.memoryReady ??= loadMemory().then((lines) => {
      if (this.memory.length === 0) this.memory = lines;
    });
    return this.memoryReady;
  }

  private keep(line: MemoryLine): void {
    this.memory = remember(this.memory, line);
    void saveMemory(this.memory);
  }

  join(channel: VoiceBasedChannel, text: TextBasedChannel | null): void {
    void this.loadRemembered();
    this.userLeft = false;
    this.cleanup();
    this.channel = channel;
    this.text = text;
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });
    this.connection = connection;
    this.speaker = new Speaker(connection);
    connection.receiver.speaking.on("start", (userId) => this.onSpeechStart(userId));
    connection.receiver.speaking.on("end", (userId) => this.onSpeechEnd(userId));
    connection.on("stateChange", (_, next) => {
      if (next.status !== VoiceConnectionStatus.Disconnected || this.userLeft) return;
      void this.reconnect(channel, text);
    });
    console.log(`Joined ${channel.name}`);
  }

  leave(): void {
    this.userLeft = true;
    this.cleanup();
    console.log("Left the voice channel");
  }

  private async reconnect(channel: VoiceBasedChannel, text: TextBasedChannel | null): Promise<void> {
    const connection = this.connection;
    if (!connection || this.userLeft) return;
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      if (this.userLeft) return;
      console.log("Voice connection dropped, joining again");
      this.join(channel, text);
    }
  }

  private cleanup(): void {
    this.abort.abort();
    this.abort = new AbortController();
    this.pendingTurns = 0;
    this.speaker?.stop();
    for (const capture of this.captures.values()) {
      if (capture.timer) clearTimeout(capture.timer);
      capture.stream.destroy();
      capture.decoder.delete?.();
    }
    this.captures.clear();
    this.activeSpeakers.clear();
    this.inbox = [];
    if (this.decideTimer) clearTimeout(this.decideTimer);
    this.decideTimer = null;
    this.connection?.destroy();
    this.connection = null;
    this.speaker = null;
  }

  private onSpeechStart(userId: string): void {
    if (!this.connection || userId === this.client.user?.id) return;
    const member = this.channel?.guild.members.cache.get(userId);
    if (member?.user.bot) return;
    this.activeSpeakers.add(userId);
    if (this.decideTimer) {
      clearTimeout(this.decideTimer);
      this.decideTimer = null;
    }

    let capture = this.captures.get(userId);
    if (!capture) {
      const stream = this.connection.receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.Manual },
      });
      const decoder = new OpusScript(48000, 2);
      const chunks: Buffer[] = [];
      stream.on("data", (packet: Buffer) => {
        if (!Buffer.isBuffer(packet) || packet.length <= 3 || packet.equals(SILENCE_FRAME)) return;
        try {
          chunks.push(Buffer.from(decoder.decode(packet)));
        } catch {
          // Discord sometimes sends a packet this decoder cannot read. Skip it and keep listening.
        }
      });
      stream.on("error", (error: Error) => console.error("Voice receive error", error));
      console.log(`Listening to ${userId}`);
      capture = { chunks, timer: null, stream, decoder };
      this.captures.set(userId, capture);
    }
    if (capture.timer) {
      clearTimeout(capture.timer);
      capture.timer = null;
    }
  }

  private onSpeechEnd(userId: string): void {
    const capture = this.captures.get(userId);
    if (!capture || capture.timer) return;
    capture.timer = setTimeout(() => {
      capture.timer = null;
      const pcm = Buffer.concat(capture.chunks);
      capture.chunks.length = 0;
      void this.finishUtterance(userId, pcm);
    }, 180);
  }

  private async finishUtterance(userId: string, pcm: Buffer): Promise<void> {
    this.activeSpeakers.delete(userId);
    const seconds = pcm.length / 4 / 48000;
    const samples = pcm48StereoToMono16k(pcm);
    if (seconds < MIN_SECONDS || !hasVoice(samples)) {
      this.scheduleDecide();
      return;
    }
    let transcript = "";
    try {
      transcript = cleanTranscript(await transcribe(samples));
    } catch (error) {
      console.error("Transcription failed", error);
      this.scheduleDecide();
      return;
    }
    if (!isRealSpeech(transcript) || (this.lastSpoken && isEcho(transcript, this.lastSpoken))) {
      console.log(`Ignored quiet or echo: ${transcript || "(empty)"}`);
      this.scheduleDecide();
      return;
    }
    const speaker = await this.speakerIdentity(userId);
    this.inbox.push({ userId, ...speaker, text: transcript, seconds });
    console.log(`Heard ${speaker.name} (@${speaker.username}): ${transcript}`);
    this.scheduleDecide();
  }

  private scheduleDecide(): void {
    if (this.decideTimer) clearTimeout(this.decideTimer);
    this.decideTimer = setTimeout(() => {
      this.decideTimer = null;
      this.decide();
    }, 120);
  }

  private decide(): void {
    void this.decideWhenReady();
  }

  private async decideWhenReady(): Promise<void> {
    await this.loadRemembered();
    if (this.userLeft || this.activeSpeakers.size > 0 || this.busy || this.inbox.length === 0) return;
    const batch = this.inbox.splice(0);
    const earlier = formatMemory(this.memory);
    const now = Date.now();
    for (const item of batch) {
      this.keep({
        name: item.name,
        username: item.username,
        text: item.text,
        at: now,
      });
    }
    const latestBySpeaker = new Map<string, Heard>();
    for (const item of batch) {
      const previous = latestBySpeaker.get(item.userId);
      if (!previous || completeness(item) >= completeness(previous)) latestBySpeaker.set(item.userId, item);
    }
    const speakers = [...latestBySpeaker.values()].sort((a, b) => completeness(b) - completeness(a));
    for (const heard of speakers) {
      const alsoHeard = speakers
        .filter((item) => item !== heard)
        .map((item) => `- ${item.name} (@${item.username})：${item.text}`)
        .join("\n");
      console.log(`Replying to ${heard.name}: ${heard.text}`);
      this.startTurn(heard, earlier, alsoHeard);
    }
  }

  private async speakerIdentity(userId: string): Promise<{ name: string; username: string }> {
    const guild = this.channel?.guild;
    const member = guild?.members.cache.get(userId) ?? (guild ? await guild.members.fetch(userId).catch(() => null) : null);
    return {
      name: member?.displayName ?? "有人",
      username: member?.user.username ?? userId,
    };
  }

  private startTurn(heard: Heard, memory: string, alsoHeard: string): void {
    this.busy = true;
    this.pendingTurns += 1;
    const turn: Turn = { signal: this.abort.signal };
    this.tail = this.tail.catch(() => undefined).then(async () => {
      try {
        if (!turn.signal.aborted) await this.runTurn(turn, heard, memory, alsoHeard);
      } finally {
        this.pendingTurns = Math.max(0, this.pendingTurns - 1);
        this.busy = this.pendingTurns > 0;
        if (!this.busy) this.decide();
      }
    });
  }

  private async runTurn(turn: Turn, heard: Heard, memory: string, alsoHeard: string): Promise<void> {
    await this.loadRemembered();
    if (turn.signal.aborted) return;
    const spoken: string[] = [];
    try {
      const text = await reply({
        speakerName: heard.name,
        username: heard.username,
        request: heard.text,
        memory,
        alsoHeard,
        previousLine: this.lastSpoken,
        signal: turn.signal,
        onSentence: (sentence) => {
          spoken.push(sentence);
          void this.speak(turn, sentence);
        },
      });
      if (turn.signal.aborted) return;
      const line = spoken.join("") || text;
      if (!line || isEcho(line, this.lastSpoken)) {
        console.log("Reply was empty, so nothing was spoken");
        return;
      }
      console.log(`Said: ${line}`);
      this.lastSpoken = line;
      this.keep({ name: config.botName, username: config.botName.toLowerCase(), text: line, at: Date.now() });
      await this.speaker?.waitUntilIdle();
    } catch (error) {
      if (turn.signal.aborted) return;
      console.error("Reply failed", error);
    }
  }

  private async speak(turn: Turn, sentence: string): Promise<void> {
    try {
      const mp3 = await synthesize(sentence, turn.signal);
      if (turn.signal.aborted) return;
      this.speaker?.enqueue(mp3);
      await saveReplyMp3(mp3);
    } catch (error) {
      if (turn.signal.aborted) return;
      console.error("Speech synthesis failed", error);
    }
  }

}
