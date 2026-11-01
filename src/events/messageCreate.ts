import { Message } from 'discord.js';
import { getPartyByThreadId } from '../services/partyService';
import { registerUserForRole, unregisterUser, RoleFullError } from '../services/registrationService';
import { parseRegistrationMessage } from '../validation/registrationSchemas';
import { updatePartyAnnouncementMessage } from '../services/threadService';
import { RegistrationTracker } from '../utils/registrationMetrics';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export async function handleMessageCreate(message: Message): Promise<void> {
  try {
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

    // 2. DETECT IF MESSAGE IS A REPLY TO THIS BOT
    let isReplyToBot = false;
    let referencedAuthorId: string | null = null;
    const referencedMessageId = message.reference?.messageId || null;

    if (message.reference && message.reference.messageId) {
      try {
        // Fast path 1: check repliedUser in mentions (populated by Discord gateway)
        if (message.mentions.repliedUser) {
          referencedAuthorId = message.mentions.repliedUser.id;
          if (
            referencedAuthorId === botUserId ||
            (message.client.user && referencedAuthorId === message.client.user.id) ||
            (message.client.application && referencedAuthorId === message.client.application.id)
          ) {
            isReplyToBot = true;
          }
        }

        // Fast path 2: check if referenced message is cached in channel
        if (!isReplyToBot) {
          const cachedMsg = message.channel.messages.cache.get(message.reference.messageId);
          if (cachedMsg) {
            referencedAuthorId = cachedMsg.author.id;
            const isBotAuthor =
              cachedMsg.author.id === botUserId ||
              (message.client.user && cachedMsg.author.id === message.client.user.id) ||
              (message.client.application && cachedMsg.author.id === message.client.application.id);
            const isBotApp =
              cachedMsg.applicationId === botUserId ||
              (message.client.application && cachedMsg.applicationId === message.client.application.id);
            isReplyToBot = isBotAuthor || isBotApp;
          }
        }

        // Network fallback: fetch from channel messages directly (avoiding Discord.js fetchReference cache bug)
        if (!isReplyToBot) {
          const refMsg = await message.channel.messages.fetch(message.reference.messageId).catch((fetchErr) => {
            logger.debug({ fetchErr, refMessageId: message.reference?.messageId }, 'Failed to fetch referenced message from channel');
            return null;
          });
          if (refMsg) {
            referencedAuthorId = refMsg.author.id;
            const isBotAuthor =
              refMsg.author.id === botUserId ||
              (message.client.user && refMsg.author.id === message.client.user.id) ||
              (message.client.application && refMsg.author.id === message.client.application.id);
            const isBotApp =
              refMsg.applicationId === botUserId ||
              (message.client.application && refMsg.applicationId === message.client.application.id);
            isReplyToBot = isBotAuthor || isBotApp;
          }
        }
      } catch (refErr) {
        logger.debug({ refErr, refMessageId: message.reference.messageId }, 'Could not resolve referenced message for reply check');
      }
    }

    // 3. BUILD BOT ALIASES FOR MENTION DETECTION
    const botUsername = message.client.user?.username;
    const botTag = message.client.user?.tag;
    const aliases: string[] = ['Party Raid', 'Party Raid#9161', 'Raid master'];
    if (botUsername && !aliases.includes(botUsername)) aliases.push(botUsername);
    if (botTag && !aliases.includes(botTag)) aliases.push(botTag);
    if (env.BOT_NAME_ALIAS && !aliases.includes(env.BOT_NAME_ALIAS)) aliases.push(env.BOT_NAME_ALIAS);

    // 4. FAST PARSE: Parse message content BEFORE making any database queries (<0.05ms)
    const parsed = parseRegistrationMessage(message.content, {
      botUserId,
      botAlias: aliases,
      prefix: env.BOT_PREFIX,
      isReplyToBot,
    });

    // If not targeted at the bot, ignore normal conversation in thread with ZERO database overhead
    if (!parsed.isTargetedAtBot) {
      return;
    }

    // 5. STRUCTURED LOGGING: Log incoming registration request details
    logger.info({
      incomingMessageId: message.id,
      authorId: message.author.id,
      threadId: message.channel.id,
      hasReference: Boolean(message.reference),
      referencedMessageId,
      referencedAuthorId,
      detectedRole: parsed.roleNumber !== undefined ? parsed.roleNumber : (parsed.isUnregister ? 'UNREGISTER' : null),
      isTargetedAtBot: parsed.isTargetedAtBot,
      rawContent: message.content,
      parseError: parsed.error || null,
    }, '📥 [REGISTRATION REQUEST RECEIVED]');

    // 6. PERFORMANCE MONITORING: Start trace for latency profiling
    const traceId = `reg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const tracker = new RegistrationTracker(traceId, message.author.id, message.channel.id);
    tracker.markParsed();

    const userId = message.author.id;
    const guildId = message.guild.id;
    const threadId = message.channel.id;

    // 7. SYNTAX ERROR HANDLING: Immediate reply (never leave typing state)
    if (parsed.error) {
      await message.reply({
        content: `<@${userId}>\n**INVALID ROLE**\n\`${parsed.error}\``,
      });
      tracker.markConfirmationSent();
      tracker.logCriticalPathOnly('INVALID_SYNTAX');
      logger.info({
        incomingMessageId: message.id,
        authorId: userId,
        error: parsed.error,
      }, '📤 [CONFIRMATION RESULT: INVALID_SYNTAX]');
      return;
    }

    // 8. THREAD LOOKUP: Fetch party associated with this thread (or referenced announcement)
    let party;
    try {
      party = await getPartyByThreadId(threadId, referencedMessageId || undefined);
    } catch (dbError) {
      logger.error({
        dbError,
        stack: dbError instanceof Error ? dbError.stack : undefined,
        threadId,
        referencedMessageId,
        incomingMessageId: message.id,
      }, '❌ [PARTY LOOKUP ERROR: DATABASE UNAVAILABLE]');
      await message.reply({
        content: `<@${userId}>\n**DATABASE UNAVAILABLE**\n\`Could not reach the database. Please try again in a few moments.\``,
      }).catch(() => {});
      return;
    }

    logger.info({
      incomingMessageId: message.id,
      partyFound: Boolean(party),
      partyId: party?.id || null,
      partyStatus: party?.status || null,
      threadId,
      referencedMessageId,
    }, '🔍 [PARTY LOOKUP RESULT]');

    tracker.markPartyLookup(party?.id);

    // If this thread is not associated with any active party in our database, reply clearly (prevent stuck typing)
    if (!party) {
      tracker.logCriticalPathOnly('NOT_A_PARTY_THREAD');
      logger.warn({
        incomingMessageId: message.id,
        threadId,
        referencedMessageId,
        authorId: userId,
      }, '⚠️ [NOT A PARTY THREAD]');
      await message.reply({
        content: `<@${userId}>\n**PARTY NOT FOUND**\n\`This thread is not associated with an active party.\``,
      }).catch(() => {});
      return;
    }

    // 9. UNREGISTER REQUEST ('-')
    if (parsed.isUnregister) {
      // Send typing indicator right before DB write
      message.channel.sendTyping().catch(() => {});

      try {
        const result = await unregisterUser(party.id, userId, guildId, userId, party);
        tracker.markDbTransactionCompleted(result.action, result.roleNumber);

        logger.info({
          incomingMessageId: message.id,
          partyId: party.id,
          userId,
          action: result.action,
          roleNumber: result.roleNumber,
          success: result.success,
        }, '💾 [DB TRANSACTION RESULT: UNREGISTER]');

        let replyContent: string;
        if (result.success) {
          replyContent = `<@${userId}>\n**REGISTRATION REMOVED**\n\`Your role registration has been removed.\``;
        } else {
          replyContent = `<@${userId}>\n**NOT REGISTERED**\n\`You are not currently registered for this party.\``;
        }

        // Send confirmation immediately to Discord (critical path complete!)
        await message.reply({ content: replyContent });
        tracker.markConfirmationSent();

        logger.info({
          incomingMessageId: message.id,
          replySent: true,
          action: result.action,
        }, '📤 [CONFIRMATION RESULT: UNREGISTER]');

        // Update main announcement embed asynchronously without blocking user response
        if (result.success) {
          updatePartyAnnouncementMessage(message.client, result.party)
            .then(() => tracker.markAnnouncementUpdated())
            .catch((err) => logger.warn({ err }, 'Async announcement update failed'));
        }
      } catch (error) {
        logger.error({
          error,
          stack: error instanceof Error ? error.stack : undefined,
          partyId: party.id,
          userId,
          incomingMessageId: message.id,
        }, '❌ [REGISTRATION PROCESSING ERROR: UNREGISTER]');

        await message.reply({
          content: `<@${userId}>\n**ERROR**\n\`An error occurred while removing your registration. Please try again.\``,
        }).catch(() => {});
        tracker.logCriticalPathOnly('ERROR_UNREGISTER');
      }
      return;
    }

    // 10. ROLE REGISTRATION REQUEST
    if (parsed.roleNumber !== undefined) {
      // Send typing indicator right before DB write
      message.channel.sendTyping().catch(() => {});

      try {
        // Execute atomic registration passing already fetched party to avoid redundant DB reads
        const result = await registerUserForRole(party.id, userId, parsed.roleNumber, guildId, party);
        tracker.markDbTransactionCompleted(result.action, result.roleNumber);

        logger.info({
          incomingMessageId: message.id,
          partyId: party.id,
          userId,
          action: result.action,
          roleNumber: result.roleNumber,
          roleName: result.roleName,
          success: result.success,
          errorReason: result.errorReason || null,
        }, '💾 [DB TRANSACTION RESULT: REGISTER]');

        if (result.success) {
          let replyContent: string;
          if (result.action === 'ROLE_SWITCHED') {
            replyContent = `<@${userId}>\n**ROLE UPDATED**\n\`Your registration has been moved to ${result.roleName}.\``;
          } else if (result.action === 'ALREADY_REGISTERED') {
            replyContent = `<@${userId}>\n**ALREADY REGISTERED**\n\`You are already registered as ${result.roleName}.\``;
          } else {
            replyContent = `<@${userId}>\n**REGISTRATION CONFIRMED**\n\`You are registered as ${result.roleName}.\``;
          }

          // Send confirmation reply immediately!
          await message.reply({ content: replyContent });
          tracker.markConfirmationSent();

          logger.info({
            incomingMessageId: message.id,
            replySent: true,
            action: result.action,
            roleName: result.roleName,
          }, '📤 [CONFIRMATION RESULT: REGISTER_SUCCESS]');

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

          logger.info({
            incomingMessageId: message.id,
            replySent: true,
            errorReason: result.errorReason,
          }, '📤 [CONFIRMATION RESULT: REGISTER_FAILED]');

          tracker.logCriticalPathOnly(result.errorReason || 'REJECTED');
        }
      } catch (error) {
        if (error instanceof RoleFullError) {
          await message.reply({
            content: `<@${userId}>\n**ROLE FULL**\n\`${error.roleName || 'This role'} is full. Choose another available role.\``,
          }).catch(() => {});
          tracker.markConfirmationSent();
          tracker.logCriticalPathOnly('ROLE_FULL');
          logger.info({
            incomingMessageId: message.id,
            replySent: true,
            errorReason: 'ROLE_FULL',
          }, '📤 [CONFIRMATION RESULT: ROLE_FULL]');
          return;
        }

        logger.error({
          error,
          stack: error instanceof Error ? error.stack : undefined,
          partyId: party.id,
          userId,
          roleNumber: parsed.roleNumber,
          incomingMessageId: message.id,
        }, '❌ [REGISTRATION PROCESSING ERROR: REGISTER]');

        await message.reply({
          content: `<@${userId}>\n**ERROR**\n\`An error occurred while processing your registration. Please try again.\``,
        }).catch(() => {});
        tracker.logCriticalPathOnly('ERROR');
      }
    }
  } catch (fatalErr) {
    logger.error({
      fatalErr,
      stack: fatalErr instanceof Error ? fatalErr.stack : undefined,
      messageId: message.id,
      channelId: message.channel.id,
    }, 'Unhandled error in handleMessageCreate');

    try {
      await message.reply({
        content: `<@${message.author.id}>\n**ERROR**\n\`An unexpected error occurred. Please try again.\``,
      }).catch(() => {});
    } catch {
      // Secondary error suppression
    }
  }
}
