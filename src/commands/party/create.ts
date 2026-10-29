import {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
import { generatePartyThreadName } from '../../services/embedService';
import { handleDiscordAPIError } from '../../utils/discordErrors';
import { logger } from '../../utils/logger';

export interface PartyDraftState {
  guildId: string;
  organizerId: string;
  announcementChannelId: string;
  ipRequirement: number;
  activityType: ActivityType;
  foodCount: number;
  durationMinutes: number;
  minimumTrackingToolkit: number;
  sideTracking?: SideTracking;
  title?: string;
  threadName?: string;
  roles?: PartyRoleInput[];
}

export const activeDrafts = new Map<string, PartyDraftState>();

export function getDraftKey(userId: string, guildId: string): string {
  return `${guildId}:${userId}`;
}

export function normalizeActivityType(input: string): ActivityType {
  const s = input.trim().toLowerCase();
  if (s === 'ava') return 'AVA';
  if (s === 'outlands' || s === 'outland') return 'Outlands';
  if (s === 'both') return 'Both';
  throw new Error(`Invalid Activity Type "${input}". Please enter AVA, Outlands, or Both.`);
}

export function normalizeSideTracking(input: string): SideTracking {
  const s = input.trim().toLowerCase();
  if (s === 'enabled' || s === 'enable' || s === 'yes' || s === 'true') return 'Enabled';
  if (s === 'disabled' || s === 'disable' || s === 'no' || s === 'false') return 'Disabled';
  if (s === 'not specified' || s === 'none' || s === 'not_specified') return 'Not Specified';
  throw new Error(`Invalid Side Tracking "${input}". Please enter Enabled or Disabled.`);
}

/**
 * Builds Step 1 Modal (Create Party).
 * Asks:
 * 1. Minimum IP
 * 2. Activity Type — AVA, Outlands, or Both
 * 3. Number of Foods
 * 4. Duration of Run
 * 5. Minimum Tracking Toolkit
 */
export function buildCreatePartyStep1Modal(targetChannelId: string): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`create_modal_step1:${targetChannelId}`)
    .setTitle('Create Party');

  // 1. Minimum IP
  const ipInput = new TextInputBuilder()
    .setCustomId('ip_requirement')
    .setLabel('1. Minimum IP Requirement')
    .setPlaceholder('e.g. 1500')
    .setValue('1500')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  // 2. Activity Type
  const activityInput = new TextInputBuilder()
    .setCustomId('activity_type')
    .setLabel('2. Activity Type (AVA, Outlands, Both)')
    .setPlaceholder('AVA, Outlands, or Both')
    .setValue('AVA')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  // 3. Number of Foods
  const foodsInput = new TextInputBuilder()
    .setCustomId('foods')
    .setLabel('3. Number of Foods (per player)')
    .setPlaceholder('e.g. 2')
    .setValue('2')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  // 4. Duration of Run
  const durationInput = new TextInputBuilder()
    .setCustomId('duration')
    .setLabel('4. Duration of Run')
    .setPlaceholder('e.g. 2 hours or 120 mins')
    .setValue('2 hours')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  // 5. Minimum Tracking Toolkit
  const toolkitInput = new TextInputBuilder()
    .setCustomId('toolkit')
    .setLabel('5. Minimum Tracking Toolkit')
    .setPlaceholder('e.g. 5')
    .setValue('5')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(ipInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(activityInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(foodsInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(durationInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(toolkitInput)
  );

  return modal;
}

/**
 * Builds Step 2 Modal (Party Name, Roles, Side Tracking, Thread Name).
 * Asks:
 * 6. Party Name (Default: TRACKING PARTY)
 * 7. Side Tracking — Enabled or Disabled
 * 8. Party Roles and slot capacities
 * 9. Registration Thread Name
 */
export function buildCreatePartyStep2Modal(targetChannelId: string, draft: PartyDraftState): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`create_modal_step2:${targetChannelId}`)
    .setTitle('Create Party — Roles & Tracking');

  // 6. Party Name
  const partyNameInput = new TextInputBuilder()
    .setCustomId('party_name')
    .setLabel('Party Name')
    .setPlaceholder('e.g. TRACKING PARTY, AVA NIGHT RAID, GUILD TRACKING')
    .setValue(draft.title || 'TRACKING PARTY')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100);

  // 7. Side Tracking
  const sideTrackingInput = new TextInputBuilder()
    .setCustomId('side_tracking')
    .setLabel('Side Tracking (Enabled or Disabled)')
    .setPlaceholder('Enabled or Disabled')
    .setValue(draft.sideTracking || 'Enabled')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  // 8. Party Roles and slot capacities
  const rolesString = (draft.roles || DEFAULT_ALBION_ROLES)
    .sort((a, b) => a.roleNumber - b.roleNumber)
    .map((r) => `${r.roleNumber}: ${r.roleName} (${r.capacity})`)
    .join(', ');

  const rolesInput = new TextInputBuilder()
    .setCustomId('roles')
    .setLabel('Party Roles & Capacities')
    .setPlaceholder('1: Tank (1), 2: Heal (1), 3: DPS (2)...')
    .setValue(rolesString)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  // 9. Registration Thread Name
  const defaultThreadName = draft.threadName || generatePartyThreadName({
    title: draft.title || 'Tracking Party',
    ipRequirement: draft.ipRequirement,
  });

  const threadInput = new TextInputBuilder()
    .setCustomId('thread_name')
    .setLabel('Registration Thread Name')
    .setPlaceholder('e.g. Tracking Party · 1500+ IP')
    .setValue(defaultThreadName)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(partyNameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(sideTrackingInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(rolesInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(threadInput)
  );

  return modal;
}

/**
 * Entry point for /party create.
 * Opens the native Create Party modal form directly without any messages or embeds.
 */
export async function handlePartyCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

  let announcementChannelId = interaction.channelId;
  if (targetChannel instanceof TextChannel || targetChannel instanceof NewsChannel) {
    announcementChannelId = targetChannel.id;
  } else if (targetChannel instanceof ThreadChannel && targetChannel.parentId) {
    announcementChannelId = targetChannel.parentId;
  }

  const modal = buildCreatePartyStep1Modal(announcementChannelId);
  await interaction.showModal(modal);
}

/**
 * Handles Step 1 Modal Submit.
 * Validates the first 5 questions and immediately prompts with the Step 2 form button.
 * NO configuration summaries, NO wizard embeds.
 */
export async function handleCreateModalStep1Submit(interaction: ModalSubmitInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const targetChannelId = (interaction.customId.split(':')[1] || interaction.channelId) ?? '';

  const ipStr = interaction.fields.getTextInputValue('ip_requirement');
  const activityStr = interaction.fields.getTextInputValue('activity_type');
  const foodsStr = interaction.fields.getTextInputValue('foods');
  const durationStr = interaction.fields.getTextInputValue('duration');
  const toolkitStr = interaction.fields.getTextInputValue('toolkit');

  try {
    const ipRequirement = parseInt(ipStr, 10);
    if (isNaN(ipRequirement) || ipRequirement < 0) {
      throw new Error('Minimum IP requirement must be a non-negative number.');
    }

    const activityType = normalizeActivityType(activityStr);

    const foodCount = parseInt(foodsStr, 10);
    if (isNaN(foodCount) || foodCount < 0) {
      throw new Error('Food count must be a non-negative number.');
    }

    const durationMinutes = parseDurationString(durationStr);

    const minimumTrackingToolkit = parseInt(toolkitStr, 10);
    if (isNaN(minimumTrackingToolkit) || minimumTrackingToolkit < 0) {
      throw new Error('Minimum Tracking Toolkit must be a non-negative number.');
    }

    const draft: PartyDraftState = {
      guildId,
      organizerId: userId,
      announcementChannelId: targetChannelId,
      ipRequirement,
      activityType,
      foodCount,
      durationMinutes,
      minimumTrackingToolkit,
      roles: [...DEFAULT_ALBION_ROLES],
    };

    activeDrafts.set(getDraftKey(userId, guildId), draft);

    // Ephemeral single-button prompt to open Step 2 form modal
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`create_btn_open_step2:${targetChannelId}`)
        .setLabel('Continue to Roles & Tracking Form')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📋')
    );

    await interaction.reply({
      content: 'Step 1 complete. Click below to complete the party form:',
      components: [row],
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
 * Handles button click to open Step 2 Modal.
 */
export async function handleOpenStep2Button(interaction: ButtonInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const key = getDraftKey(userId, guildId);
  const draft = activeDrafts.get(key);

  if (!draft) {
    await interaction.reply({
      content: '❌ Party configuration session expired. Please run `/party create` again.',
      ephemeral: true,
    });
    return;
  }

  const targetChannelId = interaction.customId.split(':')[1] || draft.announcementChannelId;
  const modal = buildCreatePartyStep2Modal(targetChannelId, draft);
  await interaction.showModal(modal);
}

/**
 * Handles Step 2 Modal Submit.
 * Validates remaining fields, creates party in DB, publishes announcement, and creates thread.
 */
export async function handleCreateModalStep2Submit(interaction: ModalSubmitInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const key = getDraftKey(userId, guildId);
  const draft = activeDrafts.get(key);

  if (!draft) {
    await interaction.reply({
      content: '❌ Party configuration session expired. Please run `/party create` again.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  let partyName = 'TRACKING PARTY';
  try {
    const rawName = interaction.fields.getTextInputValue('party_name')?.trim();
    if (rawName) partyName = rawName;
  } catch {
    // If field is missing in older drafts
  }

  const sideTrackingStr = interaction.fields.getTextInputValue('side_tracking');
  const rolesStr = interaction.fields.getTextInputValue('roles');
  const threadName = interaction.fields.getTextInputValue('thread_name').trim();

  try {
    const sideTracking = normalizeSideTracking(sideTrackingStr);
    const roles = parseRolesString(rolesStr);

    if (!threadName) {
      throw new Error('Registration Thread Name cannot be empty.');
    }

    draft.title = partyName;
    draft.sideTracking = sideTracking;
    draft.roles = roles;
    draft.threadName = threadName;

    // Validate complete input with CreatePartySchema
    const validated = CreatePartySchema.parse({
      guildId: draft.guildId,
      organizerId: draft.organizerId,
      announcementChannelId: draft.announcementChannelId,
      title: draft.title,
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

    // 1. Save party to database
    const party = await createParty(validated);

    // 2. Publish party announcement and create registration thread
    const { announcementMessage, thread } = await createPartyMessageAndThread(
      interaction.client,
      party,
      draft.threadName
    );

    activeDrafts.delete(key);

    await interaction.editReply({
      content: `🎉 **Party Created Successfully!**\n\n📢 **Announcement:** [Jump to Message](${announcementMessage.url})\n🧵 **Registration Thread:** <#${thread.id}>`,
    });
  } catch (error: any) {
    logger.error({ error }, 'Error completing party creation');
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: `❌ **Failed to create party:** ${error.message}`,
      });
    } else {
      await interaction.reply({
        content: `❌ **Form Error:** ${error.message}`,
        ephemeral: true,
      });
    }
  }
}
