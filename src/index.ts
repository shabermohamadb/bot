import { createDiscordClient } from './config/discord';
import { connectDatabase, disconnectDatabase } from './database/client';
import { handleReady } from './events/ready';
import { handleInteractionCreate } from './events/interactionCreate';
import { handleMessageCreate } from './events/messageCreate';
import { env } from './config/env';
import { logger } from './utils/logger';

export const client = createDiscordClient();

// Register Discord event listeners
client.once('ready', async () => {
  await handleReady(client);
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

    // 1. Connect to Database
    await connectDatabase();

    // 2. Log in to Discord gateway
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
