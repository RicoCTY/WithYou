# WithYou

WithYou is a Discord voice bot. It joins a voice channel, transcribes whoever is speaking, writes a short reply, and speaks that reply in a cloned voice.

The program does not contain a particular person. Names, the system prompt, voice direction, and the short command replies are in `config/character.json`. Secrets and the Discord server this process serves are in `.env`.

## Architecture

1. Discord sends each speaker's audio separately.
2. SenseVoice, running on this machine, turns that audio into text. Language is set by `speech.language`.
3. MiniMax writes one or two spoken sentences. Thinking is disabled, so the model answers directly. Recent lines from `logs/memory.json` are included, so the reply can refer to something said earlier.
4. Fish Audio speaks the line. `voice.model` selects the engine. `drama-3` also receives the delivery direction in `voice.tone`. That direction is not read aloud.
5. ffmpeg plays the audio into the voice channel.

If several people finish speaking together, each person gets a reply, longest utterance first. A clip shorter than about 0.8 seconds, or text that is only punctuation, is ignored. A line that repeats the bot's previous sentence is treated as echo and dropped.

## Requirements

- Node.js 22
- ffmpeg on `PATH`
- A Discord application with a bot token
- A MiniMax API key
- A Fish Audio API key and a voice id

## Setup

```bash
npm install
cp .env.example .env
cp config/character.example.json config/character.json
```

Fill in `.env` and `config/character.json`, then start the process:

```bash
npm start
```

Leave the terminal open. `Ctrl+C` stops the bot.

`npm run check` loads SenseVoice, asks MiniMax one question, and writes an MP3 under `logs/`. It needs both API keys and a voice id.

## Configuration

### `.env`

This file is not committed. It holds credentials and which Discord server this process is attached to.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Bot token from the Discord developer portal |
| `DISCORD_CLIENT_ID` | yes | Application id, used to register slash commands and build the invite link |
| `DISCORD_GUILD_ID` | yes | Server id. This is not a channel id. Right-click the server icon with Developer Mode on and choose Copy Server ID |
| `VOICE_CHANNEL_ID` | no | Voice channel the bot joins on startup. Right-click the channel and choose Copy Channel ID |
| `FISH_API_KEY` | yes | Fish Audio key |
| `MINIMAX_API_KEY` | yes | MiniMax key. Paste it as plain text. Lookalike letters from a chat app will be rejected |
| `MINIMAX_BASE_URL` | yes | `https://api.minimaxi.com/v1` for a China account. `https://api.minimax.io/v1` for an international account |
| `MINIMAX_MODEL` | no | Defaults to `MiniMax-M3`. Thinking is always turned off |
| `FISH_VOICE_ID` | no | Overrides `voice.voiceId` in the character file |
| `FISH_MODEL` | no | Overrides `voice.model` |

If `DISCORD_GUILD_ID` is not a server the bot has joined, startup still registers `/join` and `/leave` on the servers it is actually in, and prints those server ids.

### `config/character.json`

Copy `config/character.example.json` to `config/character.json`. The copy is gitignored, so each deployment can be a different person.

| Field | Purpose |
| --- | --- |
| `botName` | Name used in memory and in slash-command descriptions. The sample bot is Yui |
| `speech.language` | SenseVoice language code. `yue` is Cantonese |
| `speech.replyInstruction` | Last line of every model request |
| `speech.memoryHint` | How earlier lines are introduced |
| `voice.model` | Fish Audio model header. `drama-3` accepts the tone direction below |
| `voice.voiceId` | Fish Audio voice id |
| `voice.tone` | Drama-3 delivery direction. It is not spoken |
| `messages` | Replies to `/join`, `/leave`, and the two join errors |
| `persona` | Full system prompt |

Restart the process after changing either file.

## Discord

Create an application at https://discord.com/developers/applications, add a bot, and copy the token and application id into `.env`.

Invite the bot with the `bot` and `applications.commands` scopes and the Connect, Speak, and Send Messages permissions. The process prints an invite URL on startup. The same URL for this application is:

`https://discord.com/api/oauth2/authorize?client_id=YOUR_APPLICATION_ID&permissions=3147776&scope=bot%20applications.commands`

Replace `YOUR_APPLICATION_ID` with `DISCORD_CLIENT_ID`.

In the voice channel, `/join` brings the bot into your current channel. `/leave` disconnects it. The bot does not post the conversation in a text channel.

## Operations

Recordings of replies are written to `logs/*.mp3`. When the folder reaches 10 MP3 files, the 5 oldest are deleted.

`logs/memory.json` keeps roughly the last 24 lines, and drops lines older than about three hours. Deleting that file clears the bot's memory.

## Layout

| Path | Role |
| --- | --- |
| `src/index.ts` | Discord login and slash commands |
| `src/listen.ts` | Who is speaking, who gets a reply, memory updates |
| `src/stt.ts` | SenseVoice |
| `src/llm.ts` | MiniMax |
| `src/tts.ts` | Fish Audio |
| `src/play.ts` | Playback into the voice channel |
| `src/config.ts` | Loads `.env` and `config/character.json` |
| `config/character.example.json` | Character template |
| `config/character.json` | This deployment's character. Not committed |

Do not commit `.env`, `config/character.json`, or `launchd/`. The login agent is specific to one machine.
