import { Interaction } from 'discord.js';
import { executePartyCommand } from '../commands/party';
import {
  handleWizardButton,
  handleWizardSelect,
  handleWizardModalSubmit,
} from '../commands/party/create';
import { handleEditModalSubmit } from '../commands/party/edit';
import { handleCancelButton } from '../commands/party/cancel';
import { handleDiscordAPIError } from '../utils/discordErrors';
import { logger } from '../utils/logger';

export async function handleInteractionCreate(interaction: Interaction): Promise<void> {
  try {
    // 1. Slash Commands
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'party') {
        await executePartyCommand(interaction);
      }
      return;
    }

    // 2. Select Menus
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('wizard_select_')) {
        await handleWizardSelect(interaction);
      }
      return;
    }

    // 3. Buttons
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('wizard_btn_')) {
        await handleWizardButton(interaction);
      } else if (
        interaction.customId.startsWith('cancel_confirm:') ||
        interaction.customId.startsWith('cancel_abort:')
      ) {
        await handleCancelButton(interaction);
      }
      return;
    }

    // 4. Modal Submissions
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('wizard_modal_')) {
        await handleWizardModalSubmit(interaction);
      } else if (interaction.customId.startsWith('edit_party_modal:')) {
        await handleEditModalSubmit(interaction);
      }
      return;
    }
  } catch (error) {
    logger.error({ error }, 'Unhandled error in interactionCreate handler');

    const errInfo = handleDiscordAPIError(error, 'handleInteractionCreate');
    const responsePayload = {
      content: `❌ ${errInfo.message}`,
      ephemeral: true,
    };

    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(responsePayload).catch(() => {});
      } else {
        await interaction.reply(responsePayload).catch(() => {});
      }
    }
  }
}
