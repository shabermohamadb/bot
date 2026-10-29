import { Client, REST, Routes, ActivityType } from 'discord.js';
import { partyCommandData } from '../commands/party';
import { getActiveParties } from '../services/partyService';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export async function handleReady(client: Client): Promise<void> {
  logger.info(`Logged in as ${client.user?.tag} (ID: ${client.user?.id})`);

  // Set bot rich presence
  client.user?.setActivity('/party help | Albion Raids', {
    type: ActivityType.Watching,
  });

  // Register slash commands with Discord API
  if (env.DISCORD_TOKEN && env.DISCORD_CLIENT_ID && env.NODE_ENV !== 'test') {
    try {
      const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
      const commands = [partyCommandData.toJSON()];

      if (env.DISCORD_GUILD_ID) {
        // Fast instant guild registration for dev/testing
        logger.info(`Registering slash commands for test guild: ${env.DISCORD_GUILD_ID}`);
        await rest.put(
          Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
          { body: commands }
        );
      } else {
        // Global slash command registration
        logger.info('Registering global slash commands...');
        await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), {
          body: commands,
        });
      }

      logger.info('Slash commands registered successfully with Discord.');
    } catch (error) {
      logger.error({ error }, 'Failed to register slash commands with Discord');
    }
  }

  // Recover active parties from DB
  try {
    const activeParties = await getActiveParties();
    logger.info(
      `Recovered ${activeParties.length} active party records from database across guilds.`
    );
    for (const party of activeParties) {
      logger.debug(
        {
          partyId: party.id,
          guildId: party.guildId,
          announcementMessageId: party.announcementMessageId,
          threadId: party.threadId,
        },
        `Active party tracked: "${party.title || party.activityType}"`
      );
    }
  } catch (error) {
    logger.error({ error }, 'Failed to recover active parties from database on startup');
  }
}

