import { Guild, REST, Routes } from 'discord.js';
import { partyCommandData } from '../commands/party';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export async function handleGuildCreate(guild: Guild): Promise<void> {
  logger.info(`Bot joined guild "${guild.name}" (ID: ${guild.id}).`);

  if (env.DISCORD_TOKEN && env.DISCORD_CLIENT_ID && env.NODE_ENV !== 'test') {
    try {
      const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
      const commands = [partyCommandData.toJSON()];

      logger.info(`Syncing slash commands for new guild "${guild.name}" (${guild.id})...`);
      await rest.put(
        Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guild.id),
        { body: commands }
      );
      logger.info(`Slash commands synced for guild "${guild.name}" (${guild.id}).`);
    } catch (error) {
      logger.warn({ error, guildId: guild.id }, `Failed to sync guild slash commands for "${guild.name}"`);
    }
  }
}
