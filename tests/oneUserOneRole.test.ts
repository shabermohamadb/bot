import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { clearDatabase } from './helpers/testDb';
import { createParty, getPartyById } from '../src/services/partyService';
import {
  registerUserForRole,
  unregisterUser,
} from '../src/services/registrationService';
import { DEFAULT_ALBION_ROLES } from '../src/validation/partySchemas';
import { prisma } from '../src/database/client';

describe('One User — One Role Registration Rules', () => {
  let partyId1: string;
  let partyId2: string;
  const guildId = 'guild-one-user-rule';
  const organizerId = 'org-user-alpha';

  beforeEach(async () => {
    await clearDatabase();

    // Create Party 1 (standard AVA/Tracking party)
    const party1 = await createParty({
      guildId,
      organizerId,
      announcementChannelId: 'channel-test-1',
      threadName: 'Tracking Party · 1500+ IP',
      ipRequirement: 1500,
      activityType: 'AVA',
      foodCount: 2,
      foodRequirementScope: 'Per Player',
      durationMinutes: 120,
      minimumTrackingToolkit: 5,
      sideTracking: 'Enabled',
      roles: [...DEFAULT_ALBION_ROLES],
    });
    partyId1 = party1.id;

    // Create Party 2
    const party2 = await createParty({
      guildId,
      organizerId,
      announcementChannelId: 'channel-test-2',
      threadName: 'Tracking Party · 1400+ IP',
      ipRequirement: 1400,
      activityType: 'Outlands',
      foodCount: 1,
      foodRequirementScope: 'Per Player',
      durationMinutes: 60,
      minimumTrackingToolkit: 0,
      sideTracking: 'Disabled',
      roles: [...DEFAULT_ALBION_ROLES],
    });
    partyId2 = party2.id;
  }, 60000);

  it('Rules 1 & 2: User can occupy exactly one role in a party at any time', async () => {
    const userId = 'user-solitary';

    // Register for Role 3 (DPS Cultist)
    const res1 = await registerUserForRole(partyId1, userId, 3, guildId);
    expect(res1.success).toBe(true);
    expect(res1.action).toBe('REGISTERED');

    // Verify user is in Role 3 and NOT in any other role
    const partyAfter1 = await getPartyById(partyId1);
    const userRegistrations1 = partyAfter1?.registrations.filter((r) => r.userId === userId);
    expect(userRegistrations1?.length).toBe(1);
    expect(userRegistrations1?.[0].roleId).toBe(partyAfter1?.roles.find((r) => r.roleNumber === 3)?.id);
  });

  it('Rule 3: Moving existing registration to another role when capacity allows', async () => {
    const userId = 'user-mover';

    // Step 1: Register for Role 3
    await registerUserForRole(partyId1, userId, 3, guildId);

    // Step 2: Register for Role 4
    const res2 = await registerUserForRole(partyId1, userId, 4, guildId);
    expect(res2.success).toBe(true);
    expect(res2.action).toBe('ROLE_SWITCHED');
    expect(res2.roleNumber).toBe(4);
    expect(res2.previousRoleNumber).toBe(3);

    // Verify user is ONLY in Role 4 and Role 3 is freed up
    const partyAfter2 = await getPartyById(partyId1);
    const allUserRegs = partyAfter2?.registrations.filter((r) => r.userId === userId);
    expect(allUserRegs?.length).toBe(1);

    const role3 = partyAfter2?.roles.find((r) => r.roleNumber === 3);
    const role4 = partyAfter2?.roles.find((r) => r.roleNumber === 4);
    expect(role3?.registrations.length).toBe(0);
    expect(role4?.registrations.length).toBe(1);
    expect(role4?.registrations[0].userId).toBe(userId);
  });

  it('Rule 4: Rejects role switch if target role is full and preserves current role', async () => {
    const userTank = 'user-tank';
    const userHeal = 'user-heal';

    // Role 1 (Tank, capacity 1) taken by userTank
    await registerUserForRole(partyId1, userTank, 1, guildId);

    // Role 2 (Heal, capacity 1) taken by userHeal
    await registerUserForRole(partyId1, userHeal, 2, guildId);

    // userHeal attempts to switch to Role 1 (which is full: 1/1)
    const switchRes = await registerUserForRole(partyId1, userHeal, 1, guildId);
    expect(switchRes.success).toBe(false);
    expect(switchRes.action).toBe('REJECTED');
    expect(switchRes.errorReason).toBe('ROLE_FULL');
    expect(switchRes.roleName).toBe('Tank');

    // Confirm userHeal is STILL registered in Role 2 and NOT in Role 1
    const party = await getPartyById(partyId1);
    const healRole = party?.roles.find((r) => r.roleNumber === 2);
    const tankRole = party?.roles.find((r) => r.roleNumber === 1);

    expect(healRole?.registrations.map((r) => r.userId)).toContain(userHeal);
    expect(tankRole?.registrations.map((r) => r.userId)).toContain(userTank);
    expect(tankRole?.registrations.map((r) => r.userId)).not.toContain(userHeal);
  });

  it('Rule 5: Registering for the same role returns already registered without duplicate', async () => {
    const userId = 'user-repeat';

    // First registration for Role 3
    const first = await registerUserForRole(partyId1, userId, 3, guildId);
    expect(first.success).toBe(true);
    expect(first.action).toBe('REGISTERED');

    // Same role registration again
    const second = await registerUserForRole(partyId1, userId, 3, guildId);
    expect(second.success).toBe(true);
    expect(second.action).toBe('ALREADY_REGISTERED');
    expect(second.message).toContain('already registered');

    // Check database has strictly 1 registration
    const count = await prisma.partyRegistration.count({
      where: { partyId: partyId1, userId },
    });
    expect(count).toBe(1);
  });

  it('Rule 6: Removing registration removes only the calling user from that party', async () => {
    const userA = 'user-a';
    const userB = 'user-b';

    // Both register
    await registerUserForRole(partyId1, userA, 1, guildId);
    await registerUserForRole(partyId1, userB, 2, guildId);

    // User A unregisters
    const unreg = await unregisterUser(partyId1, userA, guildId);
    expect(unreg.success).toBe(true);
    expect(unreg.action).toBe('UNREGISTERED');

    // User A is gone, User B is still there
    const party = await getPartyById(partyId1);
    expect(party?.registrations.find((r) => r.userId === userA)).toBeUndefined();
    expect(party?.registrations.find((r) => r.userId === userB)).toBeDefined();
  });

  it('Rule 7: The same user may register for different roles in different parties', async () => {
    const userId = 'user-multitasker';

    // Register for Role 1 (Tank) in Party 1
    const p1Res = await registerUserForRole(partyId1, userId, 1, guildId);
    expect(p1Res.success).toBe(true);

    // Register for Role 2 (Heal) in Party 2
    const p2Res = await registerUserForRole(partyId2, userId, 2, guildId);
    expect(p2Res.success).toBe(true);

    // Confirm user is Tank in Party 1 and Heal in Party 2
    const party1 = await getPartyById(partyId1);
    const party2 = await getPartyById(partyId2);

    const reg1 = party1?.registrations.find((r) => r.userId === userId);
    const reg2 = party2?.registrations.find((r) => r.userId === userId);

    expect(reg1?.roleId).toBe(party1?.roles.find((r) => r.roleNumber === 1)?.id);
    expect(reg2?.roleId).toBe(party2?.roles.find((r) => r.roleNumber === 2)?.id);
  });

  it('Rule 8: Database level unique constraint (partyId, userId) prevents duplicate insertion', async () => {
    const userId = 'user-db-constraint';
    const role1 = (await getPartyById(partyId1))!.roles[0];
    const role2 = (await getPartyById(partyId1))!.roles[1];

    // Insert first record
    await prisma.partyRegistration.create({
      data: {
        partyId: partyId1,
        roleId: role1.id,
        userId,
      },
    });

    // Attempt direct database insert for a second role in the same party
    await expect(
      prisma.partyRegistration.create({
        data: {
          partyId: partyId1,
          roleId: role2.id,
          userId,
        },
      })
    ).rejects.toThrow();
  });

  it('Rule 9: Handles simultaneous registration attempts for the same user atomically', async () => {
    const userId = 'user-concurrent-race';

    // Dispatch 4 simultaneous registration calls for different roles for the same user
    const attempts = await Promise.all([
      registerUserForRole(partyId1, userId, 1, guildId),
      registerUserForRole(partyId1, userId, 2, guildId),
      registerUserForRole(partyId1, userId, 3, guildId),
      registerUserForRole(partyId1, userId, 4, guildId),
    ]);

    // All should settle cleanly without crashes or database lock corruption
    for (const res of attempts) {
      expect(['REGISTERED', 'ROLE_SWITCHED', 'ALREADY_REGISTERED']).toContain(res.action);
    }

    // Crucial check: Exactly ONE registration exists in the database for this user
    const registrations = await prisma.partyRegistration.findMany({
      where: { partyId: partyId1, userId },
    });
    expect(registrations.length).toBe(1);
  });

  afterAll(async () => {
    await clearDatabase();
  });
});

