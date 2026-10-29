import { Message } from 'discord.js';
import { getPartyByThreadId } from '../services/partyService';
import { registerUserForRole, unregisterUser, RoleFullError } from '../services/registrationService';
import { parseRegistrationMessage } from '../validation/registrationSchemas';
import { updatePartyAnnouncementMessage } from '../services/threadService';
import { RegistrationTracker } from '../utils/registrationMetrics';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export async function handleMessageCreate(message: Message): Promise<void> {
  // 1. FAST FILTER: Ignore messages from bots or outside of a guild immediately (<0.01ms)
  if (message.author.bot || !message.guild) {
    return;
  }

  // Registrations only happen inside threads
  if (!message.channel.isThread()) {
    return;
  }

  const botUserId = message.client.user?.id;
  if (!botUserId) return;

  // 2. FAST PARSE: Parse message content BEFORE making any database queries (<0.05ms)
  const parsed = parseRegistrationMessage(message.content, {
    botUserId,
    botAlias: env.BOT_ALIAS_ENABLED ? env.BOT_NAME_ALIAS : undefined,
    prefix: env.BOT_PREFIX,
  });

  // If not targeted at the bot, ignore normal conversation in thread with ZERO database overhead
  if (!parsed.isTargetedAtBot) {
    return;
  }

  // 3. PERFORMANCE MONITORING: Start trace for latency profiling
  const traceId = `reg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const tracker = new RegistrationTracker(traceId, message.author.id, message.channel.id);
  tracker.markParsed();

  // 4. IMMEDIATE DISCORD FEEDBACK: Send typing indicator so user sees immediate bot response (<5ms)
  message.channel.sendTyping().catch(() => {});

  const userId = message.author.id;
  const guildId = message.guild.id;
  const threadId = message.channel.id;

  // 5. THREAD LOOKUP: Fetch party associated with this thread (served from 15s cache if warm)
  const party = await getPartyByThreadId(threadId);
  tracker.markPartyLookup(party?.id);

  // If this thread is not associated with any party in our database, ignore
  if (!party) {
    tracker.logCriticalPathOnly('NOT_A_PARTY_THREAD');
    return;
  }

  // 6. SYNTAX ERROR HANDLING: Immediate reply
  if (parsed.error) {
    await message.reply({
      content: `<@${userId}>\n**INVALID ROLE**\n\`Invalid role number. Check the role list in this thread.\``,
    });
    tracker.markConfirmationSent();
    tracker.logCriticalPathOnly('INVALID_SYNTAX');
    return;
  }

  // 7. UNREGISTER REQUEST ('-')
  if (parsed.isUnregister) {
    try {
      const result = await unregisterUser(party.id, userId, guildId, userId, party);
      tracker.markDbTransactionCompleted(result.action, result.roleNumber);

      if (result.success) {
        // Send confirmation immediately to Discord (critical path complete!)
        await message.reply({
          content: `<@${userId}>\n**REGISTRATION REMOVED**\n\`Your role registration has been removed.\``,
        });
        tracker.markConfirmationSent();

        // Update main announcement embed asynchronously without blocking user response
        updatePartyAnnouncementMessage(message.client, result.party)
          .then(() => tracker.markAnnouncementUpdated())
          .catch((err) => logger.warn({ err }, 'Async announcement update failed'));
      } else {
        await message.reply({
          content: `<@${userId}>\n**NOT REGISTERED**\n\`You are not currently registered for this party.\``,
        });
        tracker.markConfirmationSent();
        tracker.logCriticalPathOnly('NOT_REGISTERED');
      }
    } catch (error) {
      logger.error({ error, partyId: party.id, userId }, 'Error processing unregistration');
      await message.reply({
        content: `<@${userId}>\n**ERROR**\n\`An error occurred while removing your registration. Please try again.\``,
      });
      tracker.logCriticalPathOnly('ERROR_UNREGISTER');
    }
    return;
  }

  // 8. ROLE REGISTRATION REQUEST
  if (parsed.roleNumber !== undefined) {
    try {
      // Execute optimized atomic registration passing already fetched party to avoid redundant DB reads
      const result = await registerUserForRole(party.id, userId, parsed.roleNumber, guildId, party);
      tracker.markDbTransactionCompleted(result.action, result.roleNumber);

      if (result.success) {
        let replyContent: string;
        if (result.action === 'ROLE_SWITCHED') {
          replyContent = `<@${userId}>\n**ROLE UPDATED**\n\`Your registration has been moved to ${result.roleName}.\``;
        } else if (result.action === 'ALREADY_REGISTERED') {
          replyContent = `<@${userId}>\n**ALREADY REGISTERED**\n\`You are already registered as ${result.roleName}.\``;
        } else {
          replyContent = `<@${userId}>\n**REGISTRATION CONFIRMED**\n\`You are registered as ${result.roleName}.\``;
        }

        // CRITICAL PATH MILESTONE: Send confirmation reply immediately!
        await message.reply({ content: replyContent });
        tracker.markConfirmationSent();

        // Asynchronously update announcement embed only if roster actually changed
        if (result.action !== 'ALREADY_REGISTERED') {
          updatePartyAnnouncementMessage(message.client, result.party)
            .then(() => tracker.markAnnouncementUpdated())
            .catch((err) => logger.warn({ err }, 'Async announcement update failed'));
        } else {
          tracker.logCriticalPathOnly('ALREADY_REGISTERED');
        }
      } else {
        let errorContent: string;
        if (result.errorReason === 'ROLE_FULL') {
          errorContent = `<@${userId}>\n**ROLE FULL**\n\`${result.roleName} is full. Choose another available role.\``;
        } else if (party.status !== 'OPEN') {
          errorContent = `<@${userId}>\n**PARTY CLOSED**\n\`Registration is currently closed for this party.\``;
        } else {
          errorContent = `<@${userId}>\n**INVALID ROLE**\n\`Invalid role number. Check the role list in this thread.\``;
        }

        await message.reply({ content: errorContent });
        tracker.markConfirmationSent();
        tracker.logCriticalPathOnly(result.errorReason || 'REJECTED');
      }
    } catch (error) {
      if (error instanceof RoleFullError) {
        await message.reply({
          content: `<@${userId}>\n**ROLE FULL**\n\`${error.roleName || 'This role'} is full. Choose another available role.\``,
        });
        tracker.markConfirmationSent();
        tracker.logCriticalPathOnly('ROLE_FULL');
        return;
      }
      logger.error({ error, partyId: party.id, userId, roleNumber: parsed.roleNumber }, 'Error processing role registration');
      await message.reply({
        content: `<@${userId}>\n**ERROR**\n\`An error occurred while processing your registration. Please try again.\``,
      });
      tracker.logCriticalPathOnly('ERROR');
    }
  }
}


