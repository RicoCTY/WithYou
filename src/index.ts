import { once } from "node:events";
import { generateDependencyReport } from "@discordjs/voice";
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type TextBasedChannel,
  type VoiceBasedChannel,
} from "discord.js";
import { config } from "./config.js";
import { VoiceCall } from "./listen.js";
import { loadLlm } from "./llm.js";
import { loadStt } from "./stt.js";

const commands = [
  new SlashCommandBuilder().setName("join").setDescription(`${config.botName} joins your voice channel`).toJSON(),
  new SlashCommandBuilder().setName("leave").setDescription(`${config.botName} leaves the voice channel`).toJSON(),
];

function inviteUrl(clientId: string): string {
  const permissions = (1 << 20) + (1 << 21) + (1 << 11);
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=bot%20applications.commands`;
}

function isVoice(channel: unknown): channel is VoiceBasedChannel {
  return Boolean(channel && typeof channel === "object" && "isVoiceBased" in channel && (channel as VoiceBasedChannel).isVoiceBased());
}

function asText(channel: unknown): TextBasedChannel | null {
  if (!channel || typeof channel !== "object" || !("isTextBased" in channel)) return null;
  const text = channel as TextBasedChannel;
  if (!text.isTextBased() || text.isDMBased()) return null;
  return text;
}

async function main(): Promise<void> {
  if (!config.discordToken) {
    console.error(`Set DISCORD_TOKEN in .env before starting ${config.botName}.`);
    process.exit(1);
  }
  console.log(generateDependencyReport());

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });
  const call = new VoiceCall(client);

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() || !interaction.guild) return;
    try {
      if (interaction.commandName === "leave") {
        call.leave();
        await interaction.reply(config.leaveReply);
        return;
      }
      if (interaction.commandName !== "join") return;
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const voice = member.voice.channel;
      if (!isVoice(voice)) {
        await interaction.reply({ content: config.needVoiceReply, ephemeral: true });
        return;
      }
      call.join(voice, asText(interaction.channel));
      await interaction.reply(config.joinReply);
    } catch (error) {
      console.error("Command failed", error);
      const payload = { content: config.joinFailedReply, ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    }
  });

  const ready = once(client, "clientReady");
  await client.login(config.discordToken);
  await ready;
  const me = client.user;
  if (!me) throw new Error("Discord login did not return a user");
  console.log(`Logged in as ${me.tag}`);

  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const clientId = config.discordClientId || me.id;
  const joined = [...client.guilds.cache.values()];
  const configured = config.discordGuildId;
  const guildIds = configured && client.guilds.cache.has(configured) ? [configured] : joined.map((guild) => guild.id);
  if (configured && !client.guilds.cache.has(configured)) {
    console.error(`DISCORD_GUILD_ID ${configured} is not a server ${config.botName} has joined. Use the server id, not a channel id.`);
    console.error(`She is in: ${joined.map((guild) => `${guild.name} (${guild.id})`).join(", ") || "no servers"}`);
  }
  if (guildIds.length === 0) {
    console.error(`${config.botName} is not in any server.\nOpen this link, choose the server, and authorize the bot:\n${inviteUrl(clientId)}`);
    process.exit(1);
  }
  for (const guildId of guildIds) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log(`Registered commands in ${client.guilds.cache.get(guildId)?.name ?? guildId}`);
  }
  console.log(`Invite: ${inviteUrl(clientId)}`);

  await Promise.all([loadStt(), loadLlm()]);

  if (config.voiceChannelId) {
    const channel = await client.channels.fetch(config.voiceChannelId);
    if (!isVoice(channel) || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
      console.error("VOICE_CHANNEL_ID is not a voice channel");
    } else {
      call.join(channel, channel.guild.systemChannel);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
