import { EmbedBuilder, Colors } from 'discord.js';
import { Party, PartyRole, PartyRegistration } from '@prisma/client';

export type PartyWithRelations = Party & {
  roles: (PartyRole & {
    registrations: PartyRegistration[];
  })[];
  registrations?: PartyRegistration[];
};

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0 && remainingMinutes > 0) {
    return `${hours} hr${hours > 1 ? 's' : ''} ${remainingMinutes} min${remainingMinutes > 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  return `${minutes} minutes`;
}

/**
 * Builds the primary party announcement embed displayed in the announcement channel.
 */
export function buildPartyEmbed(party: PartyWithRelations): EmbedBuilder {
  const embed = new EmbedBuilder();

  // Status color & title formatting
  let statusEmoji = '🟢';
  let statusText = 'Registration Open';
  let color: number = Colors.Gold;

  if (party.status === 'CLOSED') {
    statusEmoji = '🔒';
    statusText = 'Registration Closed';
    color = Colors.Grey;
  } else if (party.status === 'CANCELLED') {
    statusEmoji = '❌';
    statusText = 'Party Cancelled';
    color = Colors.Red;
  }

  const titlePrefix = party.status === 'OPEN' ? '⚔️' : statusEmoji;
  const mainTitle = party.title || `${party.activityType} Party — ${party.ipRequirement}+ IP`;
  embed.setTitle(`${titlePrefix} ${mainTitle}`);
  embed.setColor(color);

  // Header if present
  if (party.header) {
    embed.setDescription(party.header);
  }

  // Calculate totals
  let totalSlots = 0;
  let totalRegistered = 0;

  // Format Roles List
  const rolesLines = party.roles
    .sort((a, b) => a.roleNumber - b.roleNumber)
    .map((role) => {
      totalSlots += role.capacity;
      const registeredCount = role.registrations ? role.registrations.length : 0;
      totalRegistered += registeredCount;

      const userMentions = role.registrations && role.registrations.length > 0
        ? ` (${role.registrations.map((r) => `<@${r.userId}>`).join(', ')})`
        : '';

      const isFull = registeredCount >= role.capacity;
      const rolePrefix = isFull ? '🔴' : '🟢';

      return `${rolePrefix} **${role.roleNumber} — ${role.roleName}**: ${registeredCount}/${role.capacity}${userMentions}`;
    });

  embed.addFields([
    {
      name: '📋 Party Details',
      value: [
        `**Organizer:** <@${party.organizerId}>`,
        `**Activity:** ${party.activityType}`,
        `**Minimum IP:** ${party.ipRequirement}`,
        `**Foods:** ${party.foodCount} (${party.foodRequirementScope})`,
        `**Duration:** ${formatDuration(party.durationMinutes)}`,
        `**Min Tracking Toolkit:** ${party.minimumTrackingToolkit}`,
        `**Side Tracking:** ${party.sideTracking}`,
      ].join('\n'),
      inline: false,
    },
    {
      name: `👥 Roles (${totalRegistered}/${totalSlots} Slots Filled)`,
      value: rolesLines.length > 0 ? rolesLines.join('\n') : 'No roles configured.',
      inline: false,
    },
    {
      name: '🧵 Registration Thread',
      value: party.threadId
        ? `<#${party.threadId}> — ${statusText}`
        : statusText,
      inline: false,
    },
  ]);

  if (party.footer) {
    embed.setFooter({ text: party.footer });
  } else {
    embed.setFooter({
      text: `Raid Master • ID: ${party.id} • Created at`,
    });
  }

  embed.setTimestamp(party.createdAt);
  return embed;
}

/**
 * Builds the initial registration instructions embed posted inside the party thread.
 */
export function buildThreadInstructionsEmbed(
  party: Party & { roles: PartyRole[] },
  botMentionOrAlias: string = '@Raid master'
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('⚔️ Party Registration')
    .setColor(Colors.Blue)
    .setDescription(
      `Mention the bot (**${botMentionOrAlias}**) and send the number corresponding to your desired role.\n\n` +
      `**Role Mapping:**\n` +
      party.roles
        .sort((a, b) => a.roleNumber - b.roleNumber)
        .map((r) => `\`${r.roleNumber}\` — **${r.roleName}** (${r.capacity} slot${r.capacity > 1 ? 's' : ''})`)
        .join('\n') +
      `\n\n` +
      `**How to Register:**\n` +
      `• Register: \`${botMentionOrAlias} 1\`\n` +
      `• Switch Role: Send a different role number (e.g. \`${botMentionOrAlias} 3\`)\n` +
      `• Unregister: \`${botMentionOrAlias} -\`\n\n` +
      `*Party requirements and real-time availability are displayed in the main announcement message.*`
    )
    .setFooter({ text: 'Raid Master • Automatic Registration System' });

  return embed;
}

/**
 * Builds an ephemeral status embed for /party status command.
 */
export function buildPartyStatusEmbed(party: PartyWithRelations): EmbedBuilder {
  const embed = buildPartyEmbed(party);
  embed.setTitle(`📊 Status: ${party.title || `${party.activityType} Party`}`);
  return embed;
}
