import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { clearDatabase } from './helpers/testDb';
import { createParty, closeParty } from '../src/services/partyService';
import {
  registerUserForRole,
  unregisterUser,
} from '../src/services/registrationService';
import { DEFAULT_ALBION_ROLES } from '../src/validation/partySchemas';

describe('Registration System Tests', () => {
  let partyId: string;
  const guildId = 'guild-reg-test';
  const organizerId = 'org-user-1';

  beforeEach(async () => {
    await clearDatabase();

    // Setup standard party:
    // Role 1: Tank (capacity: 1)
    // Role 2: Heal (capacity: 1)
    // Role 3: DPS Cultist (capacity: 2)
    // Role 4: DPS Mana (capacity: 1)
    // Role 5: DPS Stalker (capacity: 1)
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

  // Test 4: Registering a member using role number 1
  it('4. Registers a member using role number 1', async () => {
    const userId = 'user-tank';
    const result = await registerUserForRole(partyId, userId, 1, guildId);

    expect(result.success).toBe(true);
    expect(result.action).toBe('REGISTERED');
    expect(result.roleNumber).toBe(1);
    expect(result.roleName).toBe('Tank');

    // Verify party composition in updated state
    const tankRole = result.party.roles.find((r) => r.roleNumber === 1);
    expect(tankRole?.registrations.length).toBe(1);
    expect(tankRole?.registrations[0].userId).toBe(userId);
  });

  // Test 5: Registering a member using role number 3
  it('5. Registers a member using role number 3', async () => {
    const userId = 'user-dps';
    const result = await registerUserForRole(partyId, userId, 3, guildId);

    expect(result.success).toBe(true);
    expect(result.action).toBe('REGISTERED');
    expect(result.roleNumber).toBe(3);
    expect(result.roleName).toBe('DPS Cultist');

    const cultistRole = result.party.roles.find((r) => r.roleNumber === 3);
    expect(cultistRole?.registrations.length).toBe(1);
    expect(cultistRole?.registrations[0].userId).toBe(userId);
  });

  // Test 6: Removing a registration with '-'
  it('6. Removes a registration with "-"', async () => {
    const userId = 'user-to-remove';

    // Register first
    await registerUserForRole(partyId, userId, 2, guildId);

    // Now unregister
    const unregResult = await unregisterUser(partyId, userId, guildId);
    expect(unregResult.success).toBe(true);
    expect(unregResult.action).toBe('UNREGISTERED');
    expect(unregResult.roleNumber).toBe(2);

    // Verify counts updated
    const healRole = unregResult.party.roles.find((r) => r.roleNumber === 2);
    expect(healRole?.registrations.length).toBe(0);
  });

  // Test 7: Switching roles successfully
  it('7. Switches roles successfully when destination has capacity', async () => {
    const userId = 'user-switcher';

    // Register for Role 1 (Tank)
    await registerUserForRole(partyId, userId, 1, guildId);

    // Switch to Role 3 (DPS Cultist)
    const switchResult = await registerUserForRole(partyId, userId, 3, guildId);
    expect(switchResult.success).toBe(true);
    expect(switchResult.action).toBe('ROLE_SWITCHED');
    expect(switchResult.roleNumber).toBe(3);
    expect(switchResult.previousRoleNumber).toBe(1);

    // Verify Role 1 is now 0/1 and Role 3 is 1/2
    const role1 = switchResult.party.roles.find((r) => r.roleNumber === 1);
    const role3 = switchResult.party.roles.find((r) => r.roleNumber === 3);

    expect(role1?.registrations.length).toBe(0);
    expect(role3?.registrations.length).toBe(1);
    expect(role3?.registrations[0].userId).toBe(userId);
  });

  // Test 8: Rejecting a role switch when the new role is full
  it('8. Rejects a role switch when the new role is full and preserves the existing role', async () => {
    const userTank = 'user-tank';
    const userHeal = 'user-heal';

    // User Tank takes Role 1 (capacity: 1)
    await registerUserForRole(partyId, userTank, 1, guildId);

    // User Heal takes Role 2 (capacity: 1)
    await registerUserForRole(partyId, userHeal, 2, guildId);

    // User Heal tries to switch to Role 1 (which is full: 1/1)
    const switchAttempt = await registerUserForRole(partyId, userHeal, 1, guildId);

    expect(switchAttempt.success).toBe(false);
    expect(switchAttempt.action).toBe('REJECTED');
    expect(switchAttempt.message).toContain('already full');
    expect(switchAttempt.message).toContain('Heal');

    // Confirm userHeal is STILL registered as Heal (Role 2)
    const party = switchAttempt.party;
    const healRole = party.roles.find((r) => r.roleNumber === 2);
    const tankRole = party.roles.find((r) => r.roleNumber === 1);

    expect(healRole?.registrations.map((r) => r.userId)).toContain(userHeal);
    expect(tankRole?.registrations.map((r) => r.userId)).toContain(userTank);
    expect(tankRole?.registrations.map((r) => r.userId)).not.toContain(userHeal);
  });

  // Test 9: Preventing duplicate registrations
  it('9. Prevents duplicate registrations for the same user in the same party', async () => {
    const userId = 'user-duplicate-check';

    // First registration for Role 3
    const first = await registerUserForRole(partyId, userId, 3, guildId);
    expect(first.success).toBe(true);
    expect(first.action).toBe('REGISTERED');

    // Second registration attempt for the exact same role
    const second = await registerUserForRole(partyId, userId, 3, guildId);
    expect(second.success).toBe(true);
    expect(second.message).toContain('already registered');

    // Role 3 should still only have 1 registration
    const role3 = second.party.roles.find((r) => r.roleNumber === 3);
    expect(role3?.registrations.filter((r) => r.userId === userId).length).toBe(1);
  });

  // Test 11: Rejecting invalid role numbers
  it('11. Rejects invalid role numbers with a helpful explanation', async () => {
    const userId = 'user-invalid-role';

    // Role 99 does not exist (roles are 1..5)
    const result = await registerUserForRole(partyId, userId, 99, guildId);

    expect(result.success).toBe(false);
    expect(result.action).toBe('REJECTED');
    expect(result.message).toContain('Invalid role number **99**');
    expect(result.message).toContain('Available roles are:');
  });

  // Test 12: Rejecting registrations in closed parties
  it('12. Rejects registrations when the party is closed', async () => {
    const userId = 'user-late';

    // Close the party first
    await closeParty(partyId, organizerId, guildId);

    // Attempt to register
    const result = await registerUserForRole(partyId, userId, 1, guildId);

    expect(result.success).toBe(false);
    expect(result.action).toBe('REJECTED');
    expect(result.message).toContain('closed');
  });

  // Test 14: Handling simultaneous registrations for the final available slot
  it('14. Handles simultaneous registrations for the final slot without exceeding capacity', async () => {
    // Role 1 (Tank) has capacity: 1
    const users = ['user-race-1', 'user-race-2', 'user-race-3'];

    // Run 3 simultaneous registration promises
    const promises = users.map((u) => registerUserForRole(partyId, u, 1, guildId));
    const results = await Promise.all(promises);

    const successful = results.filter((r) => r.success && r.action === 'REGISTERED');
    const rejected = results.filter((r) => !r.success);

    // Exactly 1 user should succeed, other 2 should be rejected due to capacity
    expect(successful.length).toBe(1);
    expect(rejected.length).toBe(2);

    for (const r of rejected) {
      expect(r.message).toContain('already full');
    }
  });

  afterAll(async () => {
    await clearDatabase();
  });
});

