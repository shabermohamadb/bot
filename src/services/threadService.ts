import {
  Client,
  TextChannel,
  NewsChannel,
  ThreadChannel,
  ThreadAutoArchiveDuration,
  Message,
} from 'discord.js';
import { PartyWithRelations, buildPartyEmbed, buildThreadInstructionsEmbed } from './embedService';
import { updatePartyDiscordIds } from './partyService';
import { handleDiscordAPIError } from '../utils/discordErrors';
import { logger } from '../utils/logger';

// Pending update timers to debounce rapid Discord announcement embed edits
const pendingUpdates = new Map<string, NodeJS.Timeout>();

export interface CreatePartyDiscordEntitiesResult {
  announcementMessage: Message;
  thread: ThreadChannel;
}

/**
 * Publishes the party announcement embed and creates its dedicated registration thread.
 */
export async function createPartyMessageAndThread(
  client: Client,
  party: PartyWithRelations,
  threadName: string,
  botAlias?: string
): Promise<CreatePartyDiscordEntitiesResult> {
  const channel = await client.channels.fetch(party.announcementChannelId);

  if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel)) {
    throw new Error(
      `Announcement channel <#${party.announcementChannelId}> not found or is not a text channel.`
    );
  }

  // 1. Send announcement embed
  const embed = buildPartyEmbed(party);
  const announcementMessage = await channel.send({ embeds: [embed] });

  // 2. Create dedicated thread attached to the message
  let thread: ThreadChannel;
  try {
    thread = await announcementMessage.startThread({
      name: threadName,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      reason: `Raid Master Party Registration for Party ${party.id}`,
    });
  } catch (error) {
    // If thread creation fails, clean up the announcement message to avoid orphaned posts
    try {
      await announcementMessage.delete();
    } catch (cleanupErr) {
      logger.warn({ cleanupErr }, 'Could not clean up announcement message after thread creation failure');
    }
    throw error;
  }

  // 3. Post registration instructions inside the thread
  try {
    const instructionsEmbed = buildThreadInstructionsEmbed(
      party,
      botAlias || client.user?.username || '@Raid master'
    );
    await thread.send({ embeds: [instructionsEmbed] });
  } catch (error) {
    logger.warn({ error, threadId: thread.id }, 'Failed to post instructions embed to thread');
  }

  // 4. Update DB with message ID and thread ID
  await updatePartyDiscordIds(party.id, announcementMessage.id, thread.id);

  logger.info(
    { partyId: party.id, messageId: announcementMessage.id, threadId: thread.id },
    'Successfully published party announcement and created registration thread'
  );

  return { announcementMessage, thread };
}

/**
 * Updates the original party announcement embed with latest counts and status.
 * Uses a debounce delay (300ms) to prevent rate limits during rapid registrations.
 */
export async function updatePartyAnnouncementMessage(
  client: Client,
  party: PartyWithRelations
): Promise<void> {
  if (!party.announcementChannelId || !party.announcementMessageId) {
    return;
  }

  const key = `${party.announcementChannelId}:${party.announcementMessageId}`;

  if (pendingUpdates.has(key)) {
    clearTimeout(pendingUpdates.get(key)!);
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(async () => {
      pendingUpdates.delete(key);
      try {
        const channel = await client.channels.fetch(party.announcementChannelId);
        if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel)) {
          logger.warn({ channelId: party.announcementChannelId }, 'Announcement channel not found for update');
          resolve();
          return;
        }

        const message = await channel.messages.fetch(party.announcementMessageId!);
        if (!message) {
          logger.warn({ messageId: party.announcementMessageId }, 'Party announcement message not found for update');
          resolve();
          return;
        }

        const embed = buildPartyEmbed(party);
        await message.edit({ embeds: [embed] });
        logger.debug({ partyId: party.id }, 'Updated party announcement embed');
      } catch (error) {
        handleDiscordAPIError(error, `updatePartyAnnouncementMessage(partyId: ${party.id})`);
      } finally {
        resolve();
      }
    }, 300);

    pendingUpdates.set(key, timeout);
  });
}
