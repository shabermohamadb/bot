import { Events } from 'discord.js';
import { createDiscordClient } from './config/discord';
import { connectDatabase, disconnectDatabase } from './database/client';
import { initRealtimeSubscriber, closeRealtime } from './services/realtimeService';
import { startWebServer, stopWebServer } from './web/server';
import { setDiscordClientForWeb } from './web/services/discordUserService';
import {
  setDatabaseStatus,
  setDiscordStatus,
  setRealtimeStatus,
} from './services/systemState';
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

client.on(Events.ShardDisconnect, () => {
  logger.warn('Discord Gateway shard disconnected');
  setDiscordStatus('disconnected');
});

client.on(Events.ShardReconnecting, () => {
  logger.info('Discord Gateway shard reconnecting');
  setDiscordStatus('connecting');
});

client.on(Events.ShardResume, () => {
  logger.info('Discord Gateway shard resumed connection');
  setDiscordStatus('connected');
});

client.once(Events.ClientReady, async () => {
  setDiscordStatus('connected');
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

/**
 * Retries Discord gateway login with exponential backoff.
 * Prevents transient Discord network blips or rate limits from crashing the Web server.
 */
async function loginDiscordWithRetry(maxAttempts = 15): Promise<void> {
  let attempt = 1;
  let delayMs = 3000;
  while (attempt <= maxAttempts) {
    try {
      logger.info({ attempt, maxAttempts }, 'Attempting Discord Gateway login...');
      await client.login(env.DISCORD_TOKEN);
      setDiscordStatus('connected');
      logger.info('Discord Gateway connected and logged in successfully.');
      return;
    } catch (err: any) {
      setDiscordStatus('error');
      logger.error(
        { err: err?.message || err, attempt, maxAttempts },
        `Discord login attempt ${attempt}/${maxAttempts} failed. Retrying in ${delayMs / 1000}s...`
      );
      if (attempt === maxAttempts) {
        logger.error('Discord gateway failed to connect after maximum retries. Web server remains active.');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(Math.round(delayMs * 1.5), 30000);
      attempt++;
    }
  }
}

/**
 * Retries database connection in background if initial connect encountered cold-start delay.
 */
function retryDatabaseConnection(intervalMs = 5000): void {
  const timer = setInterval(async () => {
    try {
      logger.info('Retrying database connection in background...');
      await connectDatabase(1, 1000);
      setDatabaseStatus('connected');
      logger.info('Database connection established successfully on retry.');
      clearInterval(timer);
    } catch {
      // Keep trying periodically
    }
  }, intervalMs);
  timer.unref();
}

export async function startBot(): Promise<void> {
  try {
    logger.info('Starting Discord Raid Master Bot...');

    // 1. Start Web Analytics Server FIRST
    // Binds immediately to 0.0.0.0:${PORT} within milliseconds.
    // Guarantees that Render's port detection and UptimeRobot /health probes receive 200 OK
    // without waiting on Neon scale-to-zero compute or Discord gateway latency.
    await startWebServer();

    // 2. Connect to Database (Neon Lakebase Postgres)
    setDatabaseStatus('connecting');
    try {
      await connectDatabase();
      setDatabaseStatus('connected');
    } catch (dbError) {
      setDatabaseStatus('error');
      logger.error({ dbError }, 'Initial database connection failed. Retrying in background...');
      retryDatabaseConnection();
    }

    // 3. Initialize Neon Realtime subscriber
    try {
      if (env.NEON_REALTIME_URL && env.NEON_REALTIME_SECRET) {
        setRealtimeStatus('connecting');
        await initRealtimeSubscriber();
        setRealtimeStatus('connected');
      } else {
        setRealtimeStatus('disabled');
      }
    } catch (rtError) {
      setRealtimeStatus('error');
      logger.warn({ rtError }, 'Neon Realtime initialization failed. Continuing without realtime subscriber.');
    }

    // 4. Log in to Discord gateway with resilient retry
    if (env.NODE_ENV !== 'test') {
      setDiscordStatus('connecting');
      loginDiscordWithRetry().catch((err) => {
        logger.error({ err }, 'Unhandled error in loginDiscordWithRetry');
      });
    } else {
      setDiscordStatus('disabled');
    }
  } catch (error) {
    logger.fatal({ error }, 'Fatal error starting web server on boot');
    process.exit(1);
  }
}

// Graceful shutdown handler
async function handleShutdown(signal: string) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    client.destroy();
    setDiscordStatus('disconnected');
    await stopWebServer();
    await closeRealtime();
    setRealtimeStatus('disconnected');
    await disconnectDatabase();
    setDatabaseStatus('disconnected');
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

