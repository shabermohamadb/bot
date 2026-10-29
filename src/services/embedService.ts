import { EmbedBuilder } from 'discord.js';
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

// Tactical Albion Online battle-ready palette:
// Deep charcoal native background with Antique Gold, Muted Silver, Restrained Crimson, and Slate accents
export const BATTLE_COLORS = {
  RECRUITING: 0xD4AF37, // Antique Gold (#D4AF37)
  FULL: 0xA0A5AA,       // Muted Silver (#A0A5AA)
  CLOSED: 0x4F545C,     // Muted Slate Grey (#4F545C)
  CANCELLED: 0xED4245,  // Restrained Crimson Red (#ED4245)
};

/**
 * Centralized title-generation function for party announcements and embeds.
 *
 * Examples:
 * - Default: "⚔️ TRACKING PARTY — 1500+ IP"
 * - Custom:  "⚔️ BLACK ZONE TRACKING — 1500+ IP"
 * - Custom:  "⚔️ GUILD TRACKING — 1600+ IP"
 *
 * Rules:
 * 1. Appends the IP requirement only once (never duplicates).
 * 2. Activity type is independent and displayed in RUN INTEL without renaming the party.
 * 3. Falls back legacy or missing party names to "TRACKING PARTY".
 */
export function generatePartyTitle(party: {
  title?: string | null;
  ipRequirement?: number | null;
  activityType?: string | null;
}): string {
  let name = (party.title || '').trim();

  // Strip leading swords or emoji variations
  name = name.replace(/^[\s⚔️⚔]+/, '').trim();

  // Normalize legacy hardcoded titles such as "AVA Party", "AVA Party — 1500+ IP", "Outlands Party"
  if (/^(AVA|Outlands|Both)\s+Party(\s*[-—/·]+\s*\d+\+?\s*IP)?(\s*(\/\/|[-—/·]+)\s*\d+\+?\s*IP)?$/i.test(name)) {
    name = 'TRACKING PARTY';
  }

  // Strip accidental duplicate IP or slash suffixes like "// 1500+ IP" or "— 1500+ IP // 1500+ IP"
  name = name.replace(/\s*(\/\/|[-—/·]+)\s*\d+\+?\s*IP\s*(\/\/|[-—/·]+)\s*\d+\+?\s*IP/gi, '');
  name = name.replace(/\s*\/\/\s*\d+\+?\s*IP/gi, '');

  // Fall back to default TRACKING PARTY if empty
  if (!name) {
    name = 'TRACKING PARTY';
  }

  const ip = party.ipRequirement;
  const ipText = ip !== undefined && ip !== null ? `${ip}+ IP` : '';

  // Check if the title already contains this IP requirement
  const hasIpAlready = ip ? new RegExp(`\\b${ip}\\s*\\+?\\s*IP\\b`, 'i').test(name) : false;

  // Clean trailing dashes/slashes
  name = name.replace(/\s*[-—/·]+\s*$/, '').trim();

  if (ipText && !hasIpAlready) {
    return `⚔️ ${name.toUpperCase()} — ${ipText}`;
  }

  return `⚔️ ${name.toUpperCase()}`;
}

/**
 * Centralized registration thread name generation function.
 * E.g. "Tracking Party · 1500+ IP" or "Black Zone Tracking · 1500+ IP"
 */
export function generatePartyThreadName(party: {
  title?: string | null;
  ipRequirement?: number | null;
}): string {
  let name = (party.title || '').trim().replace(/^[\s⚔️⚔]+/, '').trim();

  if (/^(AVA|Outlands|Both)\s+Party(\s*[-—/·]+\s*\d+\+?\s*IP)?$/i.test(name) || !name) {
    name = 'Tracking Party';
  }

  // Clean trailing double IP tails
  name = name.replace(/\s*(\/\/|[-—/·]+)\s*\d+\+?\s*IP/gi, '').trim();
  if (!name) name = 'Tracking Party';

  const ip = party.ipRequirement;
  const ipText = ip ? `${ip}+ IP` : '';
  const hasIpAlready = ip ? new RegExp(`\\b${ip}\\s*\\+?\\s*IP\\b`, 'i').test(name) : false;

  if (ipText && !hasIpAlready) {
    return `${name} · ${ipText}`;
  }

  return name;
}

/**
 * Builds the bold, tactical Tracking Party announcement embed.
 * Uses high-contrast typography, deep-charcoal Discord embed container, antique gold accents,
 * and aligned role availability without repetitive emojis.
 */
export function buildPartyEmbed(party: PartyWithRelations): EmbedBuilder {
  const embed = new EmbedBuilder();

  // 1. Centralized title generation (appends IP once, preserves custom party name)
  embed.setTitle(generatePartyTitle(party));

  // Calculate totals and status
  let totalSlots = 0;
  let totalRegistered = 0;
  const sortedRoles = [...party.roles].sort((a, b) => a.roleNumber - b.roleNumber);

  for (const role of sortedRoles) {
    totalSlots += role.capacity;
    totalRegistered += (role.registrations ? role.registrations.length : 0);
  }

  let statusText = 'RECRUITING';
  let color = BATTLE_COLORS.RECRUITING;

  if (party.status === 'CANCELLED') {
    statusText = 'CANCELLED';
    color = BATTLE_COLORS.CANCELLED;
  } else if (party.status === 'CLOSED') {
    statusText = 'CLOSED';
    color = BATTLE_COLORS.CLOSED;
  } else if (totalRegistered >= totalSlots && totalSlots > 0) {
    statusText = 'FULL';
    color = BATTLE_COLORS.FULL;
  }

  embed.setColor(color);

  // 2. Description: Subtitle with IP badge, dynamic status, occupancy, and leader detail
  const descLines: string[] = [
    `\`${party.ipRequirement}+ IP\` · \`STATUS: ${statusText}\` · \`${totalRegistered}/${totalSlots} SLOTS\``,
    `**Leader:** <@${party.organizerId}>${party.threadId ? ` · **Thread:** <#${party.threadId}>` : ''}`,
  ];

  if (party.header) {
    descLines.push('', `*${party.header}*`);
  }

  embed.setDescription(descLines.join('\n'));

  // 3. RUN INTEL Field: Compact, clear operational details
  const foodScopeStr = party.foodRequirementScope === 'Per Player' ? 'Player' : 'Party';
  const foodStr = `${party.foodCount} / ${foodScopeStr}`;
  const toolkitStr = party.minimumTrackingToolkit > 0 ? String(party.minimumTrackingToolkit) : 'None';
  const durationStr = formatDuration(party.durationMinutes);

  const intelLines = [
    `- Activity:        **${party.activityType}**`,
    `- Duration:        **${durationStr}**`,
    `- Foods:           **${foodStr}**`,
    `- Tracking Kit:    **${toolkitStr}**`,
    `- Side Tracking:   **${party.sideTracking}**`,
  ];

  // 4. SQUAD ROSTER Field: Tactical alignment with clean slot availability
  const maxRoleNameLen = Math.max(...sortedRoles.map((r) => r.roleName.length), 10);

  const roleLines = sortedRoles.map((role) => {
    const roleNum = String(role.roleNumber).padStart(2, '0');
    const roleName = role.roleName.toUpperCase().padEnd(maxRoleNameLen, ' ');
    const regCount = role.registrations ? role.registrations.length : 0;
    const remaining = role.capacity - regCount;

    let slotState = 'FULL';
    if (remaining === 1) {
      slotState = '1 SLOT';
    } else if (remaining > 1) {
      slotState = `${remaining} SLOTS`;
    }

    let line = `\`${roleNum}  ${roleName}  ${regCount} / ${role.capacity} — ${slotState}\``;

    if (role.registrations && role.registrations.length > 0) {
      const mentions = role.registrations.map((r) => `<@${r.userId}>`).join(', ');
      line += `  ${mentions}`;
    }

    return line;
  });

  embed.addFields([
    {
      name: 'RUN INTEL',
      value: intelLines.join('\n'),
      inline: false,
    },
    {
      name: `SQUAD ROSTER  ${totalRegistered}/${totalSlots}`,
      value: roleLines.length > 0 ? roleLines.join('\n') : 'No roles configured.',
      inline: false,
    },
  ]);

  // 5. Minimal footer: Party ID and timestamp
  if (party.footer) {
    embed.setFooter({ text: party.footer });
  } else {
    embed.setFooter({ text: `Party ID: ${party.id}` });
  }

  embed.setTimestamp(party.createdAt);
  return embed;
}

/**
 * Builds the initial registration instructions embed posted inside the party thread.
 * Clearly presents the role list and concise command directives.
 */
export function buildThreadInstructionsEmbed(
  party: Party & { roles: PartyRole[] },
  botMentionOrAlias: string = '@Raid master'
): EmbedBuilder {
  const sortedRoles = [...party.roles].sort((a, b) => a.roleNumber - b.roleNumber);

  const roleRosterLines = sortedRoles.map((r) => {
    const slotText = `${r.capacity} slot${r.capacity > 1 ? 's' : ''}`;
    return `- \`${r.roleNumber} — ${r.roleName}\` (${slotText})`;
  });

  let baseName = (party.title || '').trim().replace(/^[\s⚔️⚔]+/, '').trim();
  if (/^(AVA|Outlands|Both)\s+Party(\s*[-—/·]+\s*\d+\+?\s*IP)?$/i.test(baseName) || !baseName) {
    baseName = 'TRACKING PARTY';
  }
  baseName = baseName.replace(/\s*(\/\/|[-—/·]+)\s*\d+\+?\s*IP/gi, '').trim();
  if (!baseName) baseName = 'TRACKING PARTY';

  const embed = new EmbedBuilder()
    .setTitle(`⚔️  ${baseName.toUpperCase()} — REGISTRATION`)
    .setColor(BATTLE_COLORS.RECRUITING)
    .setDescription(
      `\`Mention the bot and send your role number to register.\`\n\n` +
      `**ROLE LIST**\n` +
      roleRosterLines.join('\n') +
      `\n\n` +
      `**INSTRUCTIONS**\n` +
      `- \`${botMentionOrAlias} 1\` — register as role 1.\n` +
      `- \`${botMentionOrAlias} 3\` — switch to role 3, if available.\n` +
      `- \`${botMentionOrAlias} -\` — unregister your current role.\n\n` +
      `**REQUIREMENTS**\n` +
      `- Minimum IP: **${party.ipRequirement}+**\n` +
      `- Activity: **${party.activityType}**\n` +
      `- Foods: **${party.foodCount} (${party.foodRequirementScope.toLowerCase()})**\n\n` +
      `*Live roster & availability are updated on the main announcement message.*`
    )
    .setFooter({ text: `Party ID: ${party.id}` });

  return embed;
}

/**
 * Builds the status embed for the /party status command.
 */
export function buildPartyStatusEmbed(party: PartyWithRelations): EmbedBuilder {
  return buildPartyEmbed(party);
}
