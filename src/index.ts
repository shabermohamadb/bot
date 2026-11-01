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
client.on(Events.Error, (error) => {
  logger.error({ error }, 'Discord Client encountered an error');
});

client.once(Events.ClientReady, async () => {
  try {
    await handleReady(client);
  } catch (err) {
    logger.error({ err }, 'Error in ClientReady handler');
  }
});

client.on(Events.GuildCreate, async (guild) => {
  try {
    await handleGuildCreate(guild);
  } catch (err) {
    logger.error({ err }, 'Error in GuildCreate handler');
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    await handleInteractionCreate(interaction);
  } catch (err) {
    logger.error({ err }, 'Error in interactionCreate listener');
  }
});

client.on('messageCreate', async (message) => {
  try {
    await handleMessageCreate(message);
  } catch (err) {
    logger.error({ err }, 'Error in messageCreate listener');
  }
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled Promise Rejection caught');
});

process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught Exception caught');
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

