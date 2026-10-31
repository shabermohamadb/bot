import { Events } from 'discord.js';
import { createDiscordClient } from './config/discord';
import { connectDatabase, disconnectDatabase } from './database/client';
import { initRealtimeSubscriber, closeRealtime } from './services/realtimeService';
import { startWebServer, stopWebServer } from './web/server';
import { setDiscordClientForWeb } from './web/services/discordUserService';
import { handleReady } from './events/ready';
import { handleInteractionCreate } from './events/interactionCreate';
import { handleMessageCreate } from './events/messageCreate';
import { handleGuildCreate } from './events/guildCreate';
import { env } from './config/env';
import { logger } from './utils/logger';

export const client = createDiscordClient();
setDiscordClientForWeb(client);

// Register Discord event listeners
client.once(Events.ClientReady, async () => {
  await handleReady(client);
});

client.on(Events.GuildCreate, async (guild) => {
  await handleGuildCreate(guild);
});

client.on('interactionCreate', async (interaction) => {
  await handleInteractionCreate(interaction);
});

client.on('messageCreate', async (message) => {
  await handleMessageCreate(message);
});

export async function startBot(): Promise<void> {
  try {
    logger.info('Starting Discord Raid Master Bot...');

    // 1. Connect to Database (Neon Lakebase Postgres)
    await connectDatabase();

    // 2. Initialize Neon Realtime subscriber
    await initRealtimeSubscriber();

    // 3. Start Web Analytics Server (Dashboard & API)
    await startWebServer();

    // 4. Log in to Discord gateway
    if (env.NODE_ENV !== 'test') {
      await client.login(env.DISCORD_TOKEN);
    }
  } catch (error) {
    logger.fatal({ error }, 'Fatal error during bot initialization');
    process.exit(1);
  }
}

// Graceful shutdown handler
async function handleShutdown(signal: string) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    client.destroy();
    await stopWebServer();
    await closeRealtime();
    await disconnectDatabase();
    logger.info('Graceful shutdown complete.');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// If executed directly, run the bot
if (require.main === module) {
  startBot();
}

