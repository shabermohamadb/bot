import { Client, GatewayIntentBits, Partials } from 'discord.js';

export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, // Required for reading number-based role registrations
      GatewayIntentBits.GuildMembers,   // Useful for role and organizer checks
    ],
    partials: [
      Partials.Channel,
      Partials.Message,
      Partials.ThreadMember,
    ],
  });
}

