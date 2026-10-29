import { ChatInputCommandInteraction } from 'discord.js';
import { getPartyById, getPartyByThreadId } from '../../services/partyService';
import { buildPartyStatusEmbed } from '../../services/embedService';

export async function handlePartyStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const partyIdOption = interaction.options.getString('party_id');
  const threadId = interaction.channelId;

  let party = null;

  if (partyIdOption) {
    party = await getPartyById(partyIdOption);
  } else if (threadId) {
    party = await getPartyByThreadId(threadId);
  }

  if (!party) {
    await interaction.reply({
      content:
        '❌ No active party found in this thread. Please use this command inside a party thread or provide a `party_id`.',
      ephemeral: true,
    });
    return;
  }

  const embed = buildPartyStatusEmbed(party);
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

