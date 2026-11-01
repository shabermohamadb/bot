import { describe, it, expect } from 'vitest';
import {
  buildPartyEmbed,
  buildThreadInstructionsEmbed,
  buildPartyStatusEmbed,
  BATTLE_COLORS,
  formatDuration,
  PartyWithRelations,
} from '../src/services/embedService';
import { DEFAULT_ALBION_ROLES } from '../src/validation/partySchemas';

describe('Tracking Party Battle-Ready Embed Tests', () => {
  const baseParty: PartyWithRelations = {
    id: 'cmv-test-party-123',
    guildId: 'guild-100',
    organizerId: 'org-456',
    announcementChannelId: 'chan-789',
    announcementMessageId: 'msg-111',
    threadId: 'thread-222',
    title: null,
    header: null,
    footer: null,
    threadName: 'Tracking Party · 1500+ IP',
    ipRequirement: 1500,
    activityType: 'AVA',
    foodCount: 2,
    foodRequirementScope: 'Per Player',
    durationMinutes: 120,
    minimumTrackingToolkit: 5,
    sideTracking: 'Enabled',
    status: 'OPEN',
    createdAt: new Date('2026-10-29T12:00:00Z'),
    updatedAt: new Date('2026-10-29T12:00:00Z'),
    roles: DEFAULT_ALBION_ROLES.map((r) => ({
      id: `role-${r.roleNumber}`,
      partyId: 'cmv-test-party-123',
      roleNumber: r.roleNumber,
      roleName: r.roleName,
      capacity: r.capacity,
      registrations: [],
    })),
  };

  it('1. Renders bold Tracking Party announcement embed with antique gold accents and clean layout', () => {
    const embed = buildPartyEmbed(baseParty);
    const data = embed.toJSON();

    // 1. Default branding is TRACKING PARTY
    expect(data.title).toBe('⚔️ TRACKING PARTY — 1500+ IP');

    // 2. High contrast antique gold color for recruiting
    expect(data.color).toBe(BATTLE_COLORS.RECRUITING);

    // 3. Description communicates IP, dynamic status, slots, and leader
    expect(data.description).toContain('`1500+ IP` | `STATUS: RECRUITING` | `0/6 SLOTS`');
    expect(data.description).toContain('**Leader:** <@org-456>');
    expect(data.description).toContain('**Thread:** <#thread-222>');

    // 4. No repetitive green or red emojis
    expect(data.description).not.toContain('🟢');
    expect(JSON.stringify(data)).not.toContain('🟢');

    // 5. RUN INTEL field layout (Duration completely removed)
    const intelField = data.fields?.find((f) => f.name === 'RUN INTEL');
    expect(intelField).toBeDefined();
    expect(intelField?.value).toContain('Activity: **AVA**');
    expect(intelField?.value).not.toContain('Duration');
    expect(intelField?.value).toContain('Foods: **2 / Player**');
    expect(intelField?.value).toContain('Tracking Kit: **5**');
    expect(intelField?.value).toContain('Side Tracking: **Enabled**');

    // 6. SQUAD ROSTER field layout with availability indicators and clean spacing
    const rosterField = data.fields?.find((f) => f.name?.startsWith('SQUAD ROSTER'));
    expect(rosterField).toBeDefined();
    expect(rosterField?.name).toBe('SQUAD ROSTER — 0/6');

    expect(rosterField?.value).toContain('**01  TANK**\n    0 / 1 SLOT');
    expect(rosterField?.value).toContain('**02  HEAL**\n    0 / 1 SLOT');
    expect(rosterField?.value).toContain('**03  DPS CULTIST**\n    0 / 2 SLOTS');
    expect(rosterField?.value).toContain('**04  DPS MANA**\n    0 / 1 SLOT');
    expect(rosterField?.value).toContain('**05  DPS STALKER**\n    0 / 1 SLOT');

    // 7. Minimal footer with party ID and timestamp
    expect(data.footer?.text).toBe('Party ID: cmv-test-party-123');
    expect(data.timestamp).toBe('2026-10-29T12:00:00.000Z');
  });

  it('2. Preserves custom party title and optional header if provided', () => {
    const customParty: PartyWithRelations = {
      ...baseParty,
      title: '8.3 Gold AVA Run',
      header: 'Bring T8 poison and spec gear',
      footer: 'Custom Guild Run #42',
    };

    const embed = buildPartyEmbed(customParty);
    const data = embed.toJSON();

    expect(data.title).toBe('⚔️ 8.3 GOLD AVA RUN — 1500+ IP');
    expect(data.description).toContain('*Bring T8 poison and spec gear*');
    expect(data.footer?.text).toBe('Custom Guild Run #42');
  });

  it('3. Updates embed status and color dynamically for FULL, CLOSED, and CANCELLED', () => {
    // 1. FULL status when all slots are registered
    const fullParty: PartyWithRelations = {
      ...baseParty,
      roles: baseParty.roles.map((r) => ({
        ...r,
        registrations: Array.from({ length: r.capacity }, (_, i) => ({
          id: `reg-${r.roleNumber}-${i}`,
          partyId: baseParty.id,
          partyRoleId: r.id,
          userId: `user-${r.roleNumber}-${i}`,
          roleNumber: r.roleNumber,
          registeredAt: new Date(),
        })),
      })),
    };
    const fullEmbed = buildPartyEmbed(fullParty);
    const fullData = fullEmbed.toJSON();

    expect(fullData.color).toBe(BATTLE_COLORS.FULL); // Muted silver
    expect(fullData.description).toContain('`STATUS: FULL`');

    // 2. CLOSED status
    const closedParty: PartyWithRelations = {
      ...baseParty,
      status: 'CLOSED',
    };
    const closedEmbed = buildPartyEmbed(closedParty);
    const closedData = closedEmbed.toJSON();

    expect(closedData.color).toBe(BATTLE_COLORS.CLOSED); // Slate grey
    expect(closedData.description).toContain('`STATUS: CLOSED`');

    // 3. CANCELLED status
    const cancelledParty: PartyWithRelations = {
      ...baseParty,
      status: 'CANCELLED',
    };
    const cancelledEmbed = buildPartyEmbed(cancelledParty);
    const cancelledData = cancelledEmbed.toJSON();

    expect(cancelledData.color).toBe(BATTLE_COLORS.CANCELLED); // Restrained crimson
    expect(cancelledData.description).toContain('`STATUS: CANCELLED`');
  });

  it('4. Correctly displays role availability counts and clickable member mentions', () => {
    const partyWithRegistrations: PartyWithRelations = {
      ...baseParty,
      roles: baseParty.roles.map((r) => {
        if (r.roleNumber === 1) {
          return {
            ...r,
            registrations: [
              {
                id: 'reg-1',
                partyId: baseParty.id,
                partyRoleId: r.id,
                userId: 'user-tank',
                roleNumber: 1,
                registeredAt: new Date(),
              },
            ],
          };
        }
        if (r.roleNumber === 3) {
          return {
            ...r,
            registrations: [
              {
                id: 'reg-2',
                partyId: baseParty.id,
                partyRoleId: r.id,
                userId: 'user-dps1',
                roleNumber: 3,
                registeredAt: new Date(),
              },
            ],
          };
        }
        return r;
      }),
    };

    const embed = buildPartyEmbed(partyWithRegistrations);
    const data = embed.toJSON();

    const rosterField = data.fields?.find((f) => f.name?.startsWith('SQUAD ROSTER'));
    expect(rosterField?.name).toBe('SQUAD ROSTER — 2/6');

    // Tank role full (1 / 1 SLOT)
    expect(rosterField?.value).toContain('**01  TANK**\n    1 / 1 SLOT\n    <@user-tank>');

    // DPS Cultist partially filled (1 / 2 SLOTS)
    expect(rosterField?.value).toContain('**03  DPS CULTIST**\n    1 / 2 SLOTS\n    <@user-dps1>');

    // Heal is empty (0 / 1 SLOT)
    expect(rosterField?.value).toContain('**02  HEAL**\n    0 / 1 SLOT');
    expect(rosterField?.value).not.toContain('**02  HEAL**\n    0 / 1 SLOT\n    <@');
  });

  it('5. Builds clean thread instructions embed with Tracking Party header and directives', () => {
    const threadEmbed = buildThreadInstructionsEmbed(baseParty, '@Party Raid');
    const data = threadEmbed.toJSON();

    expect(data.title).toBe('⚔️  TRACKING PARTY — REGISTRATION');
    expect(data.color).toBe(BATTLE_COLORS.RECRUITING);
    expect(data.description).toContain('`Mention the bot and send your role number to register.`');
    expect(data.description).toContain('**ROLE LIST**');
    expect(data.description).toContain('- `1 — Tank` (1 slot)');
    expect(data.description).toContain('- `3 — DPS Cultist` (2 slots)');
    expect(data.description).toContain('**INSTRUCTIONS**');
    expect(data.description).toContain('- `@Party Raid 1` — register as role 1.');
    expect(data.description).toContain('- `@Party Raid 3` — switch to role 3, if available.');
    expect(data.description).toContain('- `@Party Raid -` — unregister your current role.');
    expect(data.description).toContain('Minimum IP: **1500+**');
    expect(data.description).toContain('Activity: **AVA**');
    expect(data.footer?.text).toBe('Party ID: cmv-test-party-123');
  });

  it('6. Builds consistent status embed for /party status command', () => {
    const statusEmbed = buildPartyStatusEmbed(baseParty);
    expect(statusEmbed.toJSON().title).toBe('⚔️ TRACKING PARTY — 1500+ IP');
  });

  it('7. Correctly formats durations', () => {
    expect(formatDuration(60)).toBe('1 hour');
    expect(formatDuration(120)).toBe('2 hours');
    expect(formatDuration(90)).toBe('1 hr 30 mins');
    expect(formatDuration(45)).toBe('45 minutes');
  });
});
