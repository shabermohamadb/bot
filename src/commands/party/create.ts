import {
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Colors,
  TextChannel,
  NewsChannel,
} from 'discord.js';
import {
  ActivityType,
  FoodRequirementScope,
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

export interface DraftParty {
  guildId: string;
  organizerId: string;
  announcementChannelId: string;
  title: string;
  header: string;
  footer: string;
  threadName: string;
  ipRequirement: number;
  activityType: ActivityType;
  foodCount: number;
  foodRequirementScope: FoodRequirementScope;
  durationMinutes: number;
  minimumTrackingToolkit: number;
  sideTracking: SideTracking;
  roles: PartyRoleInput[];
}

export const activeDrafts = new Map<string, DraftParty>();

export function getDraftKey(userId: string, guildId: string): string {
  return `${guildId}:${userId}`;
}

export function buildWizardEmbed(draft: DraftParty): EmbedBuilder {
  const rolesList = draft.roles
    .sort((a, b) => a.roleNumber - b.roleNumber)
    .map((r) => `\`${r.roleNumber}\` — **${r.roleName}** (${r.capacity} slot${r.capacity > 1 ? 's' : ''})`)
    .join('\n');

  const totalSlots = draft.roles.reduce((acc, r) => acc + r.capacity, 0);

  return new EmbedBuilder()
    .setTitle('🛠️ Party Creation Wizard')
    .setColor(Colors.Blue)
    .setDescription(
      `Configure your Albion Online party details below. Use the dropdowns and buttons to customize, then click **Publish Party**.`
    )
    .addFields([
      {
        name: '📋 Requirements & Details',
        value: [
          `**Title:** ${draft.title || '*(Default)*'}`,
          `**Activity:** ${draft.activityType}`,
          `**Minimum IP:** ${draft.ipRequirement}`,
          `**Foods:** ${draft.foodCount} (${draft.foodRequirementScope})`,
          `**Duration:** ${formatDuration(draft.durationMinutes)}`,
          `**Tracking Toolkit:** ${draft.minimumTrackingToolkit}`,
          `**Side Tracking:** ${draft.sideTracking}`,
          `**Thread Name:** ${draft.threadName}`,
          `**Channel:** <#${draft.announcementChannelId}>`,
        ].join('\n'),
        inline: false,
      },
      {
        name: `👥 Roles (${totalSlots} Total Slots)`,
        value: rolesList || 'None',
        inline: false,
      },
      {
        name: '📝 Header & Footer',
        value: [
          `**Header:** ${draft.header || '*(None)*'}`,
          `**Footer:** ${draft.footer || '*(None)*'}`,
        ].join('\n'),
        inline: false,
      },
    ])
    .setFooter({ text: 'Raid Master • Ephemeral Configuration Wizard' });
}

export function buildWizardComponents(): ActionRowBuilder<any>[] {
  // Row 1: Activity select menu
  const activityMenu = new StringSelectMenuBuilder()
    .setCustomId('wizard_select_activity')
    .setPlaceholder('Select Activity Type...')
    .addOptions([
      { label: 'AVA (Avalonian Dungeon)', value: 'AVA', emoji: '⚔️' },
      { label: 'Outlands Roam / Gank', value: 'Outlands', emoji: '🌲' },
      { label: 'Both (AVA & Outlands)', value: 'Both', emoji: '🛡️' },
    ]);

  // Row 2: Side Tracking & Food Scope select menus
  const sideTrackingMenu = new StringSelectMenuBuilder()
    .setCustomId('wizard_select_side_tracking')
    .setPlaceholder('Side Tracking Setting...')
    .addOptions([
      { label: 'Side Tracking: Enabled', value: 'Enabled', emoji: '✅' },
      { label: 'Side Tracking: Disabled', value: 'Disabled', emoji: '❌' },
      { label: 'Side Tracking: Not Specified', value: 'Not Specified', emoji: '❔' },
    ]);

  // Row 3: Buttons for Modals
  const modalButtonsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('wizard_btn_details')
      .setLabel('Edit Numbers & Thread')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📝'),
    new ButtonBuilder()
      .setCustomId('wizard_btn_roles')
      .setLabel('Configure Roles')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('👥'),
    new ButtonBuilder()
      .setCustomId('wizard_btn_text')
      .setLabel('Title & Header')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🏷️')
  );

  // Row 4: Final Publish & Cancel Buttons
  const actionButtonsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('wizard_btn_publish')
      .setLabel('Publish Party')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🚀'),
    new ButtonBuilder()
      .setCustomId('wizard_btn_cancel')
      .setLabel('Discard')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('✖️')
  );

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(activityMenu),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sideTrackingMenu),
    modalButtonsRow,
    actionButtonsRow,
  ];
}

export async function handlePartyCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

  if (!targetChannel || !(targetChannel instanceof TextChannel || targetChannel instanceof NewsChannel)) {
    await interaction.reply({
      content: '❌ Please choose or run this command in a text channel where the party announcement can be posted.',
      ephemeral: true,
    });
    return;
  }

  // Pre-fill with optional slash command options if user provided any
  const ipOpt = interaction.options.getInteger('ip_requirement') ?? 1500;
  const activityOpt = (interaction.options.getString('activity') as ActivityType) ?? 'AVA';
  const durationOpt = interaction.options.getString('duration');
  const durationMinutes = durationOpt ? parseDurationString(durationOpt) : 120;
  const threadNameOpt = interaction.options.getString('thread_name') ?? `${activityOpt} ${ipOpt}+ Registration`;

  const draft: DraftParty = {
    guildId,
    organizerId: userId,
    announcementChannelId: targetChannel.id,
    title: `${activityOpt} Party — ${ipOpt}+ IP`,
    header: 'Sign up for the upcoming party run! Be geared and ready in Discord.',
    footer: 'Please join the voice channel 10 minutes prior to run departure.',
    threadName: threadNameOpt,
    ipRequirement: ipOpt,
    activityType: activityOpt,
    foodCount: 2,
    foodRequirementScope: 'Per Player',
    durationMinutes,
    minimumTrackingToolkit: 5,
    sideTracking: 'Enabled',
    roles: [...DEFAULT_ALBION_ROLES],
  };

  activeDrafts.set(getDraftKey(userId, guildId), draft);

  const embed = buildWizardEmbed(draft);
  const components = buildWizardComponents();

  await interaction.reply({
    embeds: [embed],
    components,
    ephemeral: true,
  });
}

export async function handleWizardSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const key = getDraftKey(interaction.user.id, interaction.guildId!);
  const draft = activeDrafts.get(key);

  if (!draft) {
    await interaction.reply({ content: '❌ Wizard session expired. Please run `/party create` again.', ephemeral: true });
    return;
  }

  const selected = interaction.values[0];

  if (interaction.customId === 'wizard_select_activity') {
    draft.activityType = selected as ActivityType;
    draft.title = `${draft.activityType} Party — ${draft.ipRequirement}+ IP`;
    draft.threadName = `${draft.activityType} ${draft.ipRequirement}+ Registration`;
  } else if (interaction.customId === 'wizard_select_side_tracking') {
    draft.sideTracking = selected as SideTracking;
  }

  const embed = buildWizardEmbed(draft);
  await interaction.update({ embeds: [embed] });
}

export async function handleWizardButton(interaction: ButtonInteraction): Promise<void> {
  const key = getDraftKey(interaction.user.id, interaction.guildId!);
  const draft = activeDrafts.get(key);

  if (!draft && interaction.customId !== 'wizard_btn_cancel') {
    await interaction.reply({ content: '❌ Wizard session expired. Please run `/party create` again.', ephemeral: true });
    return;
  }

  if (interaction.customId === 'wizard_btn_cancel') {
    activeDrafts.delete(key);
    await interaction.update({
      content: '❌ Party creation cancelled.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (!draft) return;

  if (interaction.customId === 'wizard_btn_details') {
    const modal = new ModalBuilder()
      .setCustomId('wizard_modal_details')
      .setTitle('Party Numbers & Thread');

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('ip_requirement')
          .setLabel('Minimum IP Requirement')
          .setStyle(TextInputStyle.Short)
          .setValue(draft.ipRequirement.toString())
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('duration')
          .setLabel('Duration (e.g. 2 hours or 120 mins)')
          .setStyle(TextInputStyle.Short)
          .setValue(`${draft.durationMinutes} mins`)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('foods')
          .setLabel('Food Count per Player')
          .setStyle(TextInputStyle.Short)
          .setValue(draft.foodCount.toString())
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('toolkit')
          .setLabel('Min Tracking Toolkit Count')
          .setStyle(TextInputStyle.Short)
          .setValue(draft.minimumTrackingToolkit.toString())
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('thread_name')
          .setLabel('Registration Thread Name')
          .setStyle(TextInputStyle.Short)
          .setValue(draft.threadName)
          .setRequired(true)
          .setMaxLength(100)
      )
    );

    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === 'wizard_btn_roles') {
    const modal = new ModalBuilder()
      .setCustomId('wizard_modal_roles')
      .setTitle('Configure Party Roles');

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

  if (interaction.customId === 'wizard_btn_text') {
    const modal = new ModalBuilder()
      .setCustomId('wizard_modal_text')
      .setTitle('Title, Header & Footer');

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Party Announcement Title')
          .setStyle(TextInputStyle.Short)
          .setValue(draft.title)
          .setRequired(false)
          .setMaxLength(100)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('header')
          .setLabel('Header Note (Optional)')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(draft.header)
          .setRequired(false)
          .setMaxLength(250)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('footer')
          .setLabel('Footer Note (Optional)')
          .setStyle(TextInputStyle.Short)
          .setValue(draft.footer)
          .setRequired(false)
          .setMaxLength(250)
      )
    );

    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === 'wizard_btn_publish') {
    // Validate complete draft with Zod
    const validation = CreatePartySchema.safeParse(draft);
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
      // 1. Create party in Database
      const party = await createParty(validation.data);

      // 2. Publish Discord announcement & thread
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
      const errInfo = handleDiscordAPIError(error, 'wizard_btn_publish');
      await interaction.followUp({
        content: `❌ **Failed to publish party:** ${errInfo.message}`,
        ephemeral: true,
      });
    }
  }
}

async function updateWizardMessage(interaction: ModalSubmitInteraction, embed: EmbedBuilder): Promise<void> {
  if (interaction.isFromMessage() && interaction.message) {
    await interaction.deferUpdate();
    await interaction.message.edit({ embeds: [embed] });
  } else {
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

export async function handleWizardModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const key = getDraftKey(interaction.user.id, interaction.guildId!);
  const draft = activeDrafts.get(key);

  if (!draft) {
    await interaction.reply({ content: '❌ Wizard session expired. Please run `/party create` again.', ephemeral: true });
    return;
  }

  if (interaction.customId === 'wizard_modal_details') {
    const ipStr = interaction.fields.getTextInputValue('ip_requirement');
    const durationStr = interaction.fields.getTextInputValue('duration');
    const foodsStr = interaction.fields.getTextInputValue('foods');
    const toolkitStr = interaction.fields.getTextInputValue('toolkit');
    const threadName = interaction.fields.getTextInputValue('thread_name').trim();

    try {
      const ip = parseInt(ipStr, 10);
      if (isNaN(ip) || ip < 0) throw new Error('IP requirement must be a non-negative number.');

      const durationMinutes = parseDurationString(durationStr);

      const foods = parseInt(foodsStr, 10);
      if (isNaN(foods) || foods < 0) throw new Error('Food count must be a non-negative number.');

      const toolkit = parseInt(toolkitStr, 10);
      if (isNaN(toolkit) || toolkit < 0) throw new Error('Tracking toolkit must be a non-negative number.');

      if (!threadName) throw new Error('Thread name cannot be empty.');

      draft.ipRequirement = ip;
      draft.durationMinutes = durationMinutes;
      draft.foodCount = foods;
      draft.minimumTrackingToolkit = toolkit;
      draft.threadName = threadName;

      const embed = buildWizardEmbed(draft);
      await updateWizardMessage(interaction, embed);
    } catch (err: any) {
      await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
    }
    return;
  }

  if (interaction.customId === 'wizard_modal_roles') {
    const rolesStr = interaction.fields.getTextInputValue('roles_input');
    try {
      const parsedRoles = parseRolesString(rolesStr);
      draft.roles = parsedRoles;

      const embed = buildWizardEmbed(draft);
      await updateWizardMessage(interaction, embed);
    } catch (err: any) {
      await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
    }
    return;
  }

  if (interaction.customId === 'wizard_modal_text') {
    const title = interaction.fields.getTextInputValue('title').trim();
    const header = interaction.fields.getTextInputValue('header').trim();
    const footer = interaction.fields.getTextInputValue('footer').trim();

    draft.title = title || `${draft.activityType} Party — ${draft.ipRequirement}+ IP`;
    draft.header = header;
    draft.footer = footer;

    const embed = buildWizardEmbed(draft);
    await updateWizardMessage(interaction, embed);
    return;
  }
}
