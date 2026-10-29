import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
} from 'discord.js';
import { handlePartyCreate } from './create';
import { handlePartyEdit } from './edit';
import { handlePartyClose } from './close';
import { handlePartyReopen } from './reopen';
import { handlePartyStatus } from './status';
import { handlePartyCancel } from './cancel';
import { handlePartyHelp } from './help';

export const partyCommandData = new SlashCommandBuilder()
  .setName('party')
  .setDescription('Albion Online Party Management and Thread Registration')
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Open the Create Party modal to configure and launch a new party')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Channel to post the party announcement (defaults to current channel)')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('edit')
      .setDescription('Edit party configuration and requirements')
      .addStringOption((opt) =>
        opt.setName('party_id').setDescription('Party ID (optional if executed inside party thread)').setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('close')
      .setDescription('Close party registration')
      .addStringOption((opt) =>
        opt.setName('party_id').setDescription('Party ID (optional if executed inside party thread)').setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('reopen')
      .setDescription('Reopen a closed party for registration')
      .addStringOption((opt) =>
        opt.setName('party_id').setDescription('Party ID (optional if executed inside party thread)').setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('status')
      .setDescription('Display party status, requirements, and registered members')
      .addStringOption((opt) =>
        opt.setName('party_id').setDescription('Party ID (optional if executed inside party thread)').setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('cancel')
      .setDescription('Cancel a party with confirmation')
      .addStringOption((opt) =>
        opt.setName('party_id').setDescription('Party ID (optional if executed inside party thread)').setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('help').setDescription('Show instructions and explain number registration system')
  );

export async function executePartyCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'create':
      return handlePartyCreate(interaction);
    case 'edit':
      return handlePartyEdit(interaction);
    case 'close':
      return handlePartyClose(interaction);
    case 'reopen':
      return handlePartyReopen(interaction);
    case 'status':
      return handlePartyStatus(interaction);
    case 'cancel':
      return handlePartyCancel(interaction);
    case 'help':
      return handlePartyHelp(interaction);
    default:
      await interaction.reply({ content: `Unknown subcommand "${subcommand}"`, ephemeral: true });
  }
}

