import {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  Colors,
  TextChannel,
  NewsChannel,
  ThreadChannel,
} from 'discord.js';
import {
  ActivityType,
  SideTracking,
  PartyRoleInput,
  DEFAULT_ALBION_ROLES,
  parseDurationString,
  parseRolesString,
  CreatePartySchema,
} from '../../validation/partySchemas';
import { createParty } from '../../services/partyService';
import { createPartyMessageAndThread } from '../../services/threadService';
import { formatDuration } from '../../services/embedService';
import { handleDiscordAPIError } from '../../utils/discordErrors';
import { logger } from '../../utils/logger';

export interface PartyDraftState {
  guildId: string;
  organizerId: string;
  announcementChannelId: string;
  ipRequirement: number;
  durationMinutes: number;
  foodCount: number;
  minimumTrackingToolkit: number;
  threadName: string;
  activityType: ActivityType;
  sideTracking: SideTracking;
  roles: PartyRoleInput[];
}

export const activeDrafts = new Map<string, PartyDraftState>();

export function getDraftKey(userId: string, guildId: string): string {
  return `${guildId}:${userId}`;
}

/**
 * Builds the native "Create Party" modal opened immediately when running /party create.
 * Replaces Party Header & Party Footer with Albion Online party fields.
 */
export function buildCreatePartyModal(targetChannelId: string): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`create_party_modal:${targetChannelId}`)
    .setTitle('Create Party');

  // 1. IP Requirement
  const ipInput = new TextInputBuilder()
    .setCustomId('ip_requirement')
    .setLabel('Minimum IP Requirement')
    .setPlaceholder('e.g. 1500')
    .setValue('1500')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  // 2. Number of Foods
  const foodsInput = new TextInputBuilder()
    .setCustomId('foods')
    .setLabel('Number of Foods (per player)')
    .setPlaceholder('e.g. 2')
    .setValue('2')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  // 3. Duration of Run
  const durationInput = new TextInputBuilder()
    .setCustomId('duration')
    .setLabel('Duration of Run')
    .setPlaceholder('e.g. 2 hours or 120 mins')
    .setValue('2 hours')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  // 4. Minimum Tracking Toolkit
  const toolkitInput = new TextInputBuilder()
    .setCustomId('toolkit')
    .setLabel('Minimum Tracking Toolkit')
    .setPlaceholder('e.g. 5')
    .setValue('5')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  // 5. Thread Name
  const threadInput = new TextInputBuilder()
    .setCustomId('thread_name')
    .setLabel('Registration Thread Name')
    .setPlaceholder('e.g. AVA 1500+ Registration')
    .setValue('AVA 1500+ Registration')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(ipInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(foodsInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(durationInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(toolkitInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(threadInput)
  );

  return modal;
}

/**
 * Builds the private ephemeral embed showing the entered fields and final controls.
 */
export function buildDraftReviewEmbed(draft: PartyDraftState): EmbedBuilder {
  const rolesList = draft.roles
    .sort((a, b) => a.roleNumber - b.roleNumber)
    .map((r) => `\`${r.roleNumber}\` — **${r.roleName}** (${r.capacity} slot${r.capacity > 1 ? 's' : ''})`)
    .join('\n');

  const totalSlots = draft.roles.reduce((acc, r) => acc + r.capacity, 0);

  return new EmbedBuilder()
    .setTitle('📋 Party Configuration — Finalize Setup')
    .setColor(Colors.Gold)
    .setDescription(
      `Your party details are saved. Select **Activity Type** and **Side Tracking** if different, then click **Create Party**.`
    )
    .addFields([
      {
        name: '⚔️ Requirements & Settings',
        value: [
          `• **Minimum IP:** ${draft.ipRequirement}`,
          `• **Number of Foods:** ${draft.foodCount} (Per Player)`,
          `• **Duration:** ${formatDuration(draft.durationMinutes)}`,
          `• **Tracking Toolkit:** ${draft.minimumTrackingToolkit}`,
          `• **Thread Name:** ${draft.threadName}`,
          `• **Activity Type:** **${draft.activityType}**`,
          `• **Side Tracking:** **${draft.sideTracking}**`,
          `• **Announcement Channel:** <#${draft.announcementChannelId}>`,
        ].join('\n'),
        inline: false,
      },
      {
        name: `👥 Configured Roles (${totalSlots} Slots)`,
        value: rolesList || 'None',
        inline: false,
      },
    ])
    .setFooter({ text: 'Private Configuration • Visible only to organizer' });
}

export function buildDraftReviewComponents(draft: PartyDraftState): ActionRowBuilder<any>[] {
  // Activity Type select menu
  const activityMenu = new StringSelectMenuBuilder()
    .setCustomId('create_select_activity')
    .setPlaceholder(`Activity: ${draft.activityType}`)
    .addOptions([
      { label: 'AVA (Avalonian Dungeon)', value: 'AVA', emoji: '⚔️', default: draft.activityType === 'AVA' },
      { label: 'Outlands Roam / Gank', value: 'Outlands', emoji: '🌲', default: draft.activityType === 'Outlands' },
      { label: 'Both (AVA & Outlands)', value: 'Both', emoji: '🛡️', default: draft.activityType === 'Both' },
    ]);

  // Side Tracking select menu
  const sideTrackingMenu = new StringSelectMenuBuilder()
    .setCustomId('create_select_side_tracking')
    .setPlaceholder(`Side Tracking: ${draft.sideTracking}`)
    .addOptions([
      { label: 'Side Tracking: Enabled', value: 'Enabled', emoji: '✅', default: draft.sideTracking === 'Enabled' },
      { label: 'Side Tracking: Disabled', value: 'Disabled', emoji: '❌', default: draft.sideTracking === 'Disabled' },
      { label: 'Side Tracking: Not Specified', value: 'Not Specified', emoji: '❔', default: draft.sideTracking === 'Not Specified' },
    ]);

  // Action buttons
  const buttonsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('create_btn_edit_roles')
      .setLabel('Edit Roles')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('👥'),
    new ButtonBuilder()
      .setCustomId('create_btn_submit')
      .setLabel('Create Party')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🚀'),
    new ButtonBuilder()
      .setCustomId('create_btn_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('✖️')
  );

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(activityMenu),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sideTrackingMenu),
    buttonsRow,
  ];
}

/**
 * /party create command entry point.
 * Directly opens the native "Create Party" modal without prior channel messages.
 */
export async function handlePartyCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

  let announcementChannelId = interaction.channelId;
  if (targetChannel instanceof TextChannel || targetChannel instanceof NewsChannel) {
    announcementChannelId = targetChannel.id;
  } else if (targetChannel instanceof ThreadChannel && targetChannel.parentId) {
    announcementChannelId = targetChannel.parentId;
  }

  // Open native Discord modal directly
  const modal = buildCreatePartyModal(announcementChannelId);
  await interaction.showModal(modal);
}

/**
 * Handles submission of the primary "Create Party" modal.
 */
export async function handleCreateModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const targetChannelId = interaction.customId.split(':')[1] || interaction.channelId || '';

  const ipStr = interaction.fields.getTextInputValue('ip_requirement');
  const foodsStr = interaction.fields.getTextInputValue('foods');
  const durationStr = interaction.fields.getTextInputValue('duration');
  const toolkitStr = interaction.fields.getTextInputValue('toolkit');
  const threadName = interaction.fields.getTextInputValue('thread_name').trim();

  try {
    const ipRequirement = parseInt(ipStr, 10);
    if (isNaN(ipRequirement) || ipRequirement < 0) {
      throw new Error('IP requirement must be a valid non-negative number.');
    }

    const foodCount = parseInt(foodsStr, 10);
    if (isNaN(foodCount) || foodCount < 0) {
      throw new Error('Food count must be a valid non-negative number.');
    }

    const durationMinutes = parseDurationString(durationStr);

    const minimumTrackingToolkit = parseInt(toolkitStr, 10);
    if (isNaN(minimumTrackingToolkit) || minimumTrackingToolkit < 0) {
      throw new Error('Tracking toolkit must be a valid non-negative number.');
    }

    if (!threadName) {
      throw new Error('Thread name cannot be empty.');
    }

    // Preserve entered state in draft
    const draft: PartyDraftState = {
      guildId,
      organizerId: userId,
      announcementChannelId: targetChannelId,
      ipRequirement,
      durationMinutes,
      foodCount,
      minimumTrackingToolkit,
      threadName,
      activityType: 'AVA',
      sideTracking: 'Enabled',
      roles: [...DEFAULT_ALBION_ROLES],
    };

    activeDrafts.set(getDraftKey(userId, guildId), draft);

    const embed = buildDraftReviewEmbed(draft);
    const components = buildDraftReviewComponents(draft);

    // Keep configuration private to organizer (ephemeral)
    await interaction.reply({
      embeds: [embed],
      components,
      ephemeral: true,
    });
  } catch (error: any) {
    await interaction.reply({
      content: `❌ **Form Error:** ${error.message}`,
      ephemeral: true,
    });
  }
}

/**
 * Handles select menus for Activity Type & Side Tracking.
 */
export async function handleCreateSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const key = getDraftKey(interaction.user.id, interaction.guildId!);
  const draft = activeDrafts.get(key);

  if (!draft) {
    await interaction.reply({
      content: '❌ Party configuration session expired. Please run `/party create` again.',
      ephemeral: true,
    });
    return;
  }

  const selected = interaction.values[0];

  if (interaction.customId === 'create_select_activity') {
    draft.activityType = selected as ActivityType;
  } else if (interaction.customId === 'create_select_side_tracking') {
    draft.sideTracking = selected as SideTracking;
  }

  const embed = buildDraftReviewEmbed(draft);
  const components = buildDraftReviewComponents(draft);
  await interaction.update({ embeds: [embed], components });
}

/**
 * Handles action buttons: Edit Roles, Create Party, Cancel.
 */
export async function handleCreateButton(interaction: ButtonInteraction): Promise<void> {
  const key = getDraftKey(interaction.user.id, interaction.guildId!);
  const draft = activeDrafts.get(key);

  if (!draft && interaction.customId !== 'create_btn_cancel') {
    await interaction.reply({
      content: '❌ Party configuration session expired. Please run `/party create` again.',
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === 'create_btn_cancel') {
    activeDrafts.delete(key);
    await interaction.update({
      content: '❌ Party creation cancelled.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (!draft) return;

  // Open modal to customize roles
  if (interaction.customId === 'create_btn_edit_roles') {
    const modal = new ModalBuilder()
      .setCustomId('create_modal_roles')
      .setTitle('Party Roles & Capacities');

    const rolesString = draft.roles
      .sort((a, b) => a.roleNumber - b.roleNumber)
      .map((r) => `${r.roleNumber}: ${r.roleName} (${r.capacity})`)
      .join(', ');

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('roles_input')
          .setLabel('Format: "1: Tank (1), 2: Heal (1)..."')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(rolesString)
          .setRequired(true)
      )
    );

    await interaction.showModal(modal);
    return;
  }

  // Final submission and party publication
  if (interaction.customId === 'create_btn_submit') {
    const validation = CreatePartySchema.safeParse({
      guildId: draft.guildId,
      organizerId: draft.organizerId,
      announcementChannelId: draft.announcementChannelId,
      title: `${draft.activityType} Party — ${draft.ipRequirement}+ IP`,
      threadName: draft.threadName,
      ipRequirement: draft.ipRequirement,
      activityType: draft.activityType,
      foodCount: draft.foodCount,
      foodRequirementScope: 'Per Player',
      durationMinutes: draft.durationMinutes,
      minimumTrackingToolkit: draft.minimumTrackingToolkit,
      sideTracking: draft.sideTracking,
      roles: draft.roles,
    });

    if (!validation.success) {
      const errorMsg = validation.error.errors.map((e) => `• ${e.message}`).join('\n');
      await interaction.reply({
        content: `❌ **Validation Error:**\n${errorMsg}`,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferUpdate();

    try {
      // 1. Save party to database
      const party = await createParty(validation.data);

      // 2. Publish announcement embed and dedicated registration thread
      const { announcementMessage, thread } = await createPartyMessageAndThread(
        interaction.client,
        party,
        draft.threadName
      );

      activeDrafts.delete(key);

      await interaction.editReply({
        content: `🎉 **Party Created Successfully!**\n\n📢 **Announcement:** [Jump to Message](${announcementMessage.url})\n🧵 **Registration Thread:** <#${thread.id}>`,
        embeds: [],
        components: [],
      });
    } catch (error) {
      const errInfo = handleDiscordAPIError(error, 'create_btn_submit');
      await interaction.followUp({
        content: `❌ **Failed to publish party:** ${errInfo.message}`,
        ephemeral: true,
      });
    }
  }
}

/**
 * Handles submission of the "Party Roles & Capacities" modal.
 */
export async function handleRolesModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const key = getDraftKey(interaction.user.id, interaction.guildId!);
  const draft = activeDrafts.get(key);

  if (!draft) {
    await interaction.reply({
      content: '❌ Party configuration session expired. Please run `/party create` again.',
      ephemeral: true,
    });
    return;
  }

  const rolesStr = interaction.fields.getTextInputValue('roles_input');
  try {
    const parsedRoles = parseRolesString(rolesStr);
    draft.roles = parsedRoles;

    const embed = buildDraftReviewEmbed(draft);
    const components = buildDraftReviewComponents(draft);

    if (interaction.isFromMessage() && interaction.message) {
      await interaction.deferUpdate();
      await interaction.message.edit({ embeds: [embed], components });
    } else {
      await interaction.reply({ embeds: [embed], components, ephemeral: true });
    }
  } catch (err: any) {
    await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
  }
}
