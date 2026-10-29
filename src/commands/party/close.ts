import { ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { getPartyById, getPartyByThreadId, closeParty } from '../../services/partyService';
import { isOrganizerOrAdmin } from '../../services/permissionService';
import { updatePartyAnnouncementMessage } from '../../services/threadService';

export async function handlePartyClose(interaction: ChatInputCommandInteraction): Promise<void> {
  const partyIdOption = interaction.options.getString('party_id');
  const threadId = interaction.channelId;

  let party = partyIdOption
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
      content: '❌ You must be the party organizer or a server administrator to close this party.',
      ephemeral: true,
    });
    return;
  }

  if (party.status === 'CLOSED') {
    await interaction.reply({
      content: 'ℹ️ This party is already closed.',
      ephemeral: true,
    });
    return;
  }

  const updatedParty = await closeParty(party.id, interaction.user.id, interaction.guildId!);
  await updatePartyAnnouncementMessage(interaction.client, updatedParty);

  await interaction.reply({
    content: `🔒 **Party registration has been closed by <@${interaction.user.id}>.** No further registrations or role changes will be accepted.`,
  });
}
