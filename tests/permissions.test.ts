import { describe, it, expect, beforeEach } from 'vitest';
import { clearDatabase } from './helpers/testDb';
import { createParty } from '../src/services/partyService';
import {
  registerUserForRole,
  unregisterUser,
} from '../src/services/registrationService';
import {
  isOrganizerOrAdmin,
  canManageRegistration,
} from '../src/services/permissionService';
import { DEFAULT_ALBION_ROLES } from '../src/validation/partySchemas';
import { PermissionFlagsBits } from 'discord.js';

describe('Permissions & Organizer Enforcement Tests', () => {
  let partyId: string;
  const guildId = 'guild-perm-test';
  const organizerId = 'party-creator-1';
  const normalUserA = 'normal-user-a';
  const normalUserB = 'normal-user-b';

  beforeEach(async () => {
    await clearDatabase();

    const party = await createParty({
      guildId,
      organizerId,
      announcementChannelId: 'channel-test',
      threadName: 'Registration Thread',
      ipRequirement: 1500,
      activityType: 'AVA',
      foodCount: 2,
      foodRequirementScope: 'Per Player',
      durationMinutes: 120,
      minimumTrackingToolkit: 5,
      sideTracking: 'Enabled',
      roles: [...DEFAULT_ALBION_ROLES],
    });

    partyId = party.id;
  });

  // Test 10: Preventing one member from removing another member's registration
  it('10. Prevents a normal member from removing another member’s registration', async () => {
    // Normal User A registers for Tank (Role 1)
    await registerUserForRole(partyId, normalUserA, 1, guildId);

    // Normal User B attempts to remove Normal User A
    const checkB = await canManageRegistration(
      {
        partyId,
        organizerId,
        guildId,
        userId: normalUserB,
        member: null,
      },
      normalUserA
    );

    expect(checkB.allowed).toBe(false);
    expect(checkB.reason).toContain('do not have permission');

    // But party organizer IS allowed to remove Normal User A
    const checkOrganizer = await canManageRegistration(
      {
        partyId,
        organizerId,
        guildId,
        userId: organizerId,
        member: null,
      },
      normalUserA
    );

    expect(checkOrganizer.allowed).toBe(true);

    // Organizer removes Normal User A via unregisterUser override
    const overrideResult = await unregisterUser(partyId, normalUserA, guildId, organizerId);
    expect(overrideResult.success).toBe(true);
    expect(overrideResult.message).toContain('Removed <@normal-user-a>');
  });

  // Test 13: Enforcing organizer-only actions
  it('13. Enforces that only organizers or administrators can perform sensitive actions', async () => {
    // 1. Party creator should be recognized as organizer
    const isCreatorOrganizer = await isOrganizerOrAdmin({
      partyId,
      organizerId,
      guildId,
      userId: organizerId,
      member: null,
    });
    expect(isCreatorOrganizer).toBe(true);

    // 2. Normal user should NOT be recognized as organizer
    const isNormalUserOrganizer = await isOrganizerOrAdmin({
      partyId,
      organizerId,
      guildId,
      userId: normalUserA,
      member: null,
    });
    expect(isNormalUserOrganizer).toBe(false);

    // 3. Guild administrator with Administrator permission flag should be recognized as organizer
    const mockAdminMember = {
      guild: { ownerId: 'guild-owner-id' },
      permissions: {
        has: (flag: bigint) => flag === PermissionFlagsBits.Administrator,
      },
      roles: {
        cache: new Map(),
      },
    } as any;

    const isAdminOrganizer = await isOrganizerOrAdmin({
      partyId,
      organizerId,
      guildId,
      userId: 'some-admin-user',
      member: mockAdminMember,
    });
    expect(isAdminOrganizer).toBe(true);

    // 4. Guild owner should be recognized as organizer
    const mockOwnerMember = {
      guild: { ownerId: 'guild-owner-id' },
      permissions: {
        has: () => false,
      },
      roles: {
        cache: new Map(),
      },
    } as any;

    const isOwnerOrganizer = await isOrganizerOrAdmin({
      partyId,
      organizerId,
      guildId,
      userId: 'guild-owner-id',
      member: mockOwnerMember,
    });
    expect(isOwnerOrganizer).toBe(true);
  });
});

