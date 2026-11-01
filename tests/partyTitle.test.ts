import { describe, it, expect } from 'vitest';
import {
  generatePartyTitle,
  generatePartyThreadName,
  buildPartyEmbed,
  PartyWithRelations,
} from '../src/services/embedService';
import { DEFAULT_ALBION_ROLES } from '../src/validation/partySchemas';

describe('Centralized Party Title & Custom Name Tests', () => {
  const createMockParty = (overrides: Partial<PartyWithRelations> = {}): PartyWithRelations => ({
    id: 'test-party-custom-title',
    guildId: 'guild-title-test',
    organizerId: 'org-title-test',
    announcementChannelId: 'channel-title-test',
    announcementMessageId: 'msg-title-test',
    threadId: 'thread-title-test',
    title: null,
    header: null,
    footer: null,
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
      partyId: 'test-party-custom-title',
      roleNumber: r.roleNumber,
      roleName: r.roleName,
      capacity: r.capacity,
      registrations: [],
    })),
    ...overrides,
  });

  describe('generatePartyTitle', () => {
    it('1. Generates default title as "⚔️ TRACKING PARTY — 1500+ IP" when title is null or empty', () => {
      const party = createMockParty({ title: null, ipRequirement: 1500 });
      expect(generatePartyTitle(party)).toBe('⚔️ TRACKING PARTY — 1500+ IP');

      const partyEmpty = createMockParty({ title: '', ipRequirement: 1500 });
      expect(generatePartyTitle(partyEmpty)).toBe('⚔️ TRACKING PARTY — 1500+ IP');
    });

    it('2. Uses custom party name: "⚔️ BLACK ZONE TRACKING — 1500+ IP"', () => {
      const party = createMockParty({
        title: 'BLACK ZONE TRACKING',
        ipRequirement: 1500,
      });
      expect(generatePartyTitle(party)).toBe('⚔️ BLACK ZONE TRACKING — 1500+ IP');
    });

    it('3. Uses custom party name with custom IP: "⚔️ GUILD TRACKING — 1600+ IP"', () => {
      const party = createMockParty({
        title: 'GUILD TRACKING',
        ipRequirement: 1600,
      });
      expect(generatePartyTitle(party)).toBe('⚔️ GUILD TRACKING — 1600+ IP');
    });

    it('4. Does not duplicate IP if already present in custom title', () => {
      const partyWithIp = createMockParty({
        title: 'BLACK ZONE TRACKING — 1500+ IP',
        ipRequirement: 1500,
      });
      expect(generatePartyTitle(partyWithIp)).toBe('⚔️ BLACK ZONE TRACKING — 1500+ IP');

      const partyWithIpVariant = createMockParty({
        title: '⚔️ GUILD TRACKING — 1600+ IP',
        ipRequirement: 1600,
      });
      expect(generatePartyTitle(partyWithIpVariant)).toBe('⚔️ GUILD TRACKING — 1600+ IP');
    });

    it('5. Fixes legacy malformed titles with duplicate IP suffixes', () => {
      const legacyParty = createMockParty({
        title: 'AVA PARTY — 1500+ IP // 1500+ IP',
        ipRequirement: 1500,
      });
      expect(generatePartyTitle(legacyParty)).toBe('⚔️ TRACKING PARTY — 1500+ IP');
    });

    it('6. Normalizes old hardcoded "AVA Party" and "Outlands Party" to TRACKING PARTY', () => {
      const oldAva = createMockParty({
        title: 'AVA Party — 1500+ IP',
        ipRequirement: 1500,
      });
      expect(generatePartyTitle(oldAva)).toBe('⚔️ TRACKING PARTY — 1500+ IP');

      const oldOutlands = createMockParty({
        title: 'Outlands Party',
        ipRequirement: 1400,
      });
      expect(generatePartyTitle(oldOutlands)).toBe('⚔️ TRACKING PARTY — 1400+ IP');
    });

    it('7. Keeps party name and activity type completely independent', () => {
      // Activity is Outlands, but party name is default TRACKING PARTY
      const outlandsParty = createMockParty({
        title: 'TRACKING PARTY',
        ipRequirement: 1500,
        activityType: 'Outlands',
      });
      expect(generatePartyTitle(outlandsParty)).toBe('⚔️ TRACKING PARTY — 1500+ IP');

      // Activity is Both, but party name is custom AVA NIGHT RAID
      const customActivityParty = createMockParty({
        title: 'AVA NIGHT RAID',
        ipRequirement: 1700,
        activityType: 'Both',
      });
      expect(generatePartyTitle(customActivityParty)).toBe('⚔️ AVA NIGHT RAID — 1700+ IP');
    });
  });

  describe('generatePartyThreadName', () => {
    it('generates thread name reflecting custom party name and IP', () => {
      expect(generatePartyThreadName({ title: 'TRACKING PARTY', ipRequirement: 1500 })).toBe(
        'TRACKING PARTY · 1500+ IP'
      );
      expect(generatePartyThreadName({ title: 'Black Zone Tracking', ipRequirement: 1600 })).toBe(
        'Black Zone Tracking · 1600+ IP'
      );
      expect(generatePartyThreadName({ title: null, ipRequirement: 1500 })).toBe(
        'Tracking Party · 1500+ IP'
      );
    });
  });

  describe('buildPartyEmbed integration', () => {
    it('embed uses centralized title and displays activity in RUN INTEL without renaming title', () => {
      const party = createMockParty({
        title: 'BLACK ZONE TRACKING',
        ipRequirement: 1500,
        activityType: 'Outlands',
      });

      const embed = buildPartyEmbed(party);
      const data = embed.toJSON();

      // Title matches centralized function
      expect(data.title).toBe('⚔️ BLACK ZONE TRACKING — 1500+ IP');

      // RUN INTEL shows independent activity
      const intelField = data.fields?.find((f) => f.name === 'RUN INTEL');
      expect(intelField).toBeDefined();
      expect(intelField?.value).toContain('Activity: **Outlands**');
    });
  });
});

