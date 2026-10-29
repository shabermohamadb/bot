import {
  ChatInputCommandInteraction,
  ButtonInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
} from 'discord.js';
import { getPartyById, getPartyByThreadId, cancelParty } from '../../services/partyService';
import { isOrganizerOrAdmin } from '../../services/permissionService';
import { updatePartyAnnouncementMessage } from '../../services/threadService';

export async function handlePartyCancel(interaction: ChatInputCommandInteraction): Promise<void> {
  const partyIdOption = interaction.options.getString('party_id');
  const threadId = interaction.channelId;

  const party = partyIdOption
    ? await getPartyById(partyIdOption)
    : await getPartyByThreadId(threadId);

  if (!party) {
    await interaction.reply({
      content: '❌ No party found. Run this inside a party thread or provide a valid `party_id`.',
      ephemeral: true,
    });
    return;
  }

  // Permission check
  const member = interaction.member instanceof GuildMember ? interaction.member : null;
  const isAuthorized = await isOrganizerOrAdmin({
    partyId: party.id,
    organizerId: party.organizerId,
    guildId: interaction.guildId!,
    userId: interaction.user.id,
    member,
  });

  if (!isAuthorized) {
    await interaction.reply({
      content: '❌ You must be the party organizer or an administrator to cancel this party.',
      ephemeral: true,
    });
    return;
  }

  if (party.status === 'CANCELLED') {
    await interaction.reply({
      content: 'ℹ️ This party is already cancelled.',
      ephemeral: true,
    });
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cancel_confirm:${party.id}`)
      .setLabel('Yes, Cancel Party')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`cancel_abort:${party.id}`)
      .setLabel('No, Keep Party')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    content: `⚠️ **Are you sure you want to cancel "${party.title || `${party.activityType} Party`}"?**\nThis will close registrations and mark the party as cancelled. Historical records will be preserved.`,
    components: [row],
    ephemeral: true,
  });
}

export async function handleCancelButton(interaction: ButtonInteraction): Promise<void> {
  const [action, partyId] = interaction.customId.split(':');

  if (action === 'cancel_abort') {
    await interaction.update({
      content: 'Party cancellation was aborted.',
      components: [],
    });
    return;
  }

  if (action === 'cancel_confirm') {
    const party = await getPartyById(partyId);
    if (!party) {
      await interaction.update({
        content: 'Party not found.',
        components: [],
      });
      return;
    }

    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    const isAuthorized = await isOrganizerOrAdmin({
      partyId: party.id,
      organizerId: party.organizerId,
      guildId: interaction.guildId!,
      userId: interaction.user.id,
      member,
    });

    if (!isAuthorized) {
      await interaction.reply({
        content: '❌ You do not have permission to cancel this party.',
        ephemeral: true,
      });
      return;
    }

    const updated = await cancelParty(party.id, interaction.user.id, interaction.guildId!);
    await updatePartyAnnouncementMessage(interaction.client, updated);

    await interaction.update({
      content: `❌ **Party has been cancelled.**`,
      components: [],
    });

    // Notify in thread if possible
    if (interaction.channel && 'send' in interaction.channel) {
      await (interaction.channel as any).send({
        content: `❌ **This party has been cancelled by <@${interaction.user.id}>.** All registrations have ended.`,
      });
    }
  }
}

