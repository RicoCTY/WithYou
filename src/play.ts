import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable } from "node:stream";
import { createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus, type VoiceConnection, type AudioPlayer } from "@discordjs/voice";

export class Speaker {
  private readonly player: AudioPlayer;
  private queue: Buffer[] = [];
  private ffmpeg: ChildProcessWithoutNullStreams | null = null;
  private token = 0;
  private playing = false;
  private idleWaiters: Array<() => void> = [];

  constructor(connection: VoiceConnection) {
    this.player = createAudioPlayer();
    connection.subscribe(this.player);
    this.player.on(AudioPlayerStatus.Idle, () => {
      this.playing = false;
      this.playNext();
    });
    this.player.on("error", (error) => {
      console.error("Playback error", error);
      this.playing = false;
      this.playNext();
    });
  }

  enqueue(mp3: Buffer): void {
    this.queue.push(mp3);
    if (!this.playing) this.playNext();
  }

  stop(): void {
    this.token += 1;
    this.queue = [];
    this.ffmpeg?.kill("SIGKILL");
    this.ffmpeg = null;
    this.playing = false;
    this.player.stop(true);
    this.resolveIdle();
  }

  waitUntilIdle(): Promise<void> {
    if (!this.playing && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private resolveIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private playNext(): void {
    const mp3 = this.queue.shift();
    if (!mp3) {
      this.playing = false;
      this.resolveIdle();
      return;
    }
    const token = this.token;
    this.playing = true;
    const ffmpeg = spawn(
      "ffmpeg",
      ["-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.ffmpeg = ffmpeg;
    ffmpeg.stderr.on("data", () => undefined);
    ffmpeg.on("close", () => {
      if (this.ffmpeg === ffmpeg) this.ffmpeg = null;
    });
    if (token !== this.token) {
      ffmpeg.kill("SIGKILL");
      return;
    }
    Readable.from(mp3).pipe(ffmpeg.stdin);
    const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
    this.player.play(resource);
  }
}
