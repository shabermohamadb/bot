import { ChatInputCommandInteraction, EmbedBuilder, Colors } from 'discord.js';

export async function handlePartyHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('⚔️ Raid Master — Bot Guide & Registration System')
    .setColor(Colors.Gold)
    .setDescription(
      '**Raid Master** is an Albion Online party organization and thread-based registration bot for AVAs, Outlands, and group roams.\n\n' +
      'All party registrations happen directly inside the dedicated party thread using role numbers!'
    )
    .addFields([
      {
        name: '🔢 How Registration Works (Inside Thread)',
        value: [
          '• **Register:** Mention the bot followed by your role number.',
          '  Example: `@Raid master 1` (Registers for Role 1)',
          '• **Switch Role:** Send a different number.',
          '  Example: `@Raid master 3` (Switches you to Role 3 if slot is open)',
          '• **Unregister:** Send the unregister token `-`.',
          '  Example: `@Raid master -` (Removes your registration)',
          '• **Capacity:** If a role is full, registrations for it are rejected.',
        ].join('\n'),
      },
      {
        name: '📜 Organizer & Party Slash Commands',
        value: [
          '`/party create` — Launch the interactive party creation wizard.',
          '`/party edit` — Edit requirements, roles, or duration for a party.',
          '`/party close` — Close registration (disables further joins/switches).',
          '`/party reopen` — Reopen registration for a closed party.',
          '`/party status` — Check current composition, filled slots, and requirements.',
          '`/party cancel` — Cancel a party with confirmation.',
          '`/party help` — Display this guide.',
        ].join('\n'),
      },
      {
        name: '🛡️ Permissions',
        value:
          'Party creators, Discord administrators, and users with the designated organizer role can manage parties. Normal members can register, switch, or remove their own registration.',
      },
    ])
    .setFooter({ text: 'Raid Master • Albion Online Party Coordinator' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

