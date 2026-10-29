import {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  GuildMember,
} from 'discord.js';
import { getPartyById, getPartyByThreadId, editParty } from '../../services/partyService';
import { isOrganizerOrAdmin } from '../../services/permissionService';
import { updatePartyAnnouncementMessage } from '../../services/threadService';
import { parseDurationString, parseRolesString } from '../../validation/partySchemas';

export async function handlePartyEdit(interaction: ChatInputCommandInteraction): Promise<void> {
  const partyIdOption = interaction.options.getString('party_id');
  const threadId = interaction.channelId;

  const party = partyIdOption
    ? await getPartyById(partyIdOption)
    : await getPartyByThreadId(threadId);

  if (!party) {
    await interaction.reply({
      content: '❌ No party found. Run this inside a party thread or specify a valid `party_id`.',
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
      content: '❌ You must be the party organizer or an administrator to edit this party.',
      ephemeral: true,
    });
    return;
  }

  // Prepare current role string
  const currentRolesStr = party.roles
    .sort((a, b) => a.roleNumber - b.roleNumber)
    .map((r) => `${r.roleNumber}: ${r.roleName} (${r.capacity})`)
    .join(', ');

  const modal = new ModalBuilder()
    .setCustomId(`edit_party_modal:${party.id}`)
    .setTitle(`Edit Party: ${party.activityType}`);

  const titleInput = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Party Title / Header')
    .setStyle(TextInputStyle.Short)
    .setValue(party.title || '')
    .setRequired(false)
    .setMaxLength(100);

  const ipInput = new TextInputBuilder()
    .setCustomId('ip_requirement')
    .setLabel('Minimum IP Requirement')
    .setStyle(TextInputStyle.Short)
    .setValue(party.ipRequirement.toString())
    .setRequired(true);

  const durationInput = new TextInputBuilder()
    .setCustomId('duration')
    .setLabel('Duration (e.g. 2 hours or 120 mins)')
    .setStyle(TextInputStyle.Short)
    .setValue(`${party.durationMinutes} mins`)
    .setRequired(true);

  const foodsInput = new TextInputBuilder()
    .setCustomId('foods')
    .setLabel('Food Count')
    .setStyle(TextInputStyle.Short)
    .setValue(party.foodCount.toString())
    .setRequired(true);

  const rolesInput = new TextInputBuilder()
    .setCustomId('roles')
    .setLabel('Roles: "Num: Name (Cap), ..."')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(currentRolesStr)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(ipInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(durationInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(foodsInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(rolesInput)
  );

  await interaction.showModal(modal);
}

export async function handleEditModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const partyId = interaction.customId.split(':')[1];
  const party = await getPartyById(partyId);

  if (!party) {
    await interaction.reply({ content: '❌ Party not found.', ephemeral: true });
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
      content: '❌ You do not have permission to edit this party.',
      ephemeral: true,
    });
    return;
  }

  const title = interaction.fields.getTextInputValue('title') || null;
  const ipStr = interaction.fields.getTextInputValue('ip_requirement');
  const durationStr = interaction.fields.getTextInputValue('duration');
  const foodsStr = interaction.fields.getTextInputValue('foods');
  const rolesStr = interaction.fields.getTextInputValue('roles');

  try {
    const ipRequirement = parseInt(ipStr, 10);
    if (isNaN(ipRequirement) || ipRequirement < 0) {
      throw new Error('IP requirement must be a non-negative number.');
    }

    const durationMinutes = parseDurationString(durationStr);
    const foodCount = parseInt(foodsStr, 10);
    if (isNaN(foodCount) || foodCount < 0) {
      throw new Error('Food count must be a non-negative number.');
    }

    const roles = rolesStr ? parseRolesString(rolesStr) : undefined;

    const updated = await editParty(
      party.id,
      {
        title,
        ipRequirement,
        durationMinutes,
        foodCount,
        roles,
      },
      interaction.user.id,
      interaction.guildId!
    );

    await updatePartyAnnouncementMessage(interaction.client, updated);

    await interaction.reply({
      content: `✅ **Party details updated successfully!** Announcement embed refreshed.`,
      ephemeral: true,
    });
  } catch (error: any) {
    await interaction.reply({
      content: `❌ **Failed to update party:** ${error.message}`,
      ephemeral: true,
    });
  }
}
