import { Message } from 'discord.js';
import { getPartyByThreadId } from '../services/partyService';
import { registerUserForRole, unregisterUser } from '../services/registrationService';
import { parseRegistrationMessage } from '../validation/registrationSchemas';
import { updatePartyAnnouncementMessage } from '../services/threadService';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export async function handleMessageCreate(message: Message): Promise<void> {
  // Ignore messages from bots or outside of a guild
  if (message.author.bot || !message.guild) {
    return;
  }

  // Registrations only happen inside threads
  if (!message.channel.isThread()) {
    return;
  }

  const threadId = message.channel.id;
  const party = await getPartyByThreadId(threadId);

  // If this thread is not associated with any party in our database, ignore
  if (!party) {
    return;
  }

  const botUserId = message.client.user?.id;
  if (!botUserId) return;

  // Parse message content
  const parsed = parseRegistrationMessage(message.content, {
    botUserId,
    botAlias: env.BOT_NAME_ALIAS,
    prefix: env.BOT_PREFIX,
  });

  // If not targeted at the bot, ignore normal conversation in thread
  if (!parsed.isTargetedAtBot) {
    return;
  }

  const userId = message.author.id;
  const guildId = message.guild.id;

  // If there was a parsing error (e.g. mentioned bot with an invalid string or no number)
  if (parsed.error) {
    await message.reply({
      content: `⚠️ <@${userId}> ${parsed.error}`,
    });
    return;
  }

  // Handle Unregister Request ('-')
  if (parsed.isUnregister) {
    try {
      const result = await unregisterUser(party.id, userId, guildId);
      if (result.success) {
        await message.reply({
          content: `✅ <@${userId}> ${result.message}`,
        });
        // Update main announcement embed
        await updatePartyAnnouncementMessage(message.client, result.party);
      } else {
        await message.reply({
          content: `⚠️ <@${userId}> ${result.message}`,
        });
      }
    } catch (error) {
      logger.error({ error, partyId: party.id, userId }, 'Error processing unregistration');
      await message.reply({
        content: `❌ <@${userId}> An error occurred while removing your registration. Please try again.`,
      });
    }
    return;
  }

  // Handle Role Number Registration
  if (parsed.roleNumber !== undefined) {
    try {
      const result = await registerUserForRole(party.id, userId, parsed.roleNumber, guildId);

      if (result.success) {
        const emoji = result.action === 'ROLE_SWITCHED' ? '🔄' : '✅';
        await message.reply({
          content: `${emoji} <@${userId}> ${result.message}`,
        });

        // Update main announcement embed
        await updatePartyAnnouncementMessage(message.client, result.party);
      } else {
        await message.reply({
          content: `❌ <@${userId}> ${result.message}`,
        });
      }
    } catch (error) {
      logger.error({ error, partyId: party.id, userId, roleNumber: parsed.roleNumber }, 'Error processing role registration');
      await message.reply({
        content: `❌ <@${userId}> An error occurred while processing your registration. Please try again.`,
      });
    }
  }
}
