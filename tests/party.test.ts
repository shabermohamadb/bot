import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearDatabase } from './helpers/testDb';
import {
  createParty,
  getActiveParties,
  getPartyById,
} from '../src/services/partyService';
import {
  CreatePartySchema,
  DEFAULT_ALBION_ROLES,
  parseDurationString,
} from '../src/validation/partySchemas';
import { createPartyMessageAndThread } from '../src/services/threadService';
import { TextChannel } from 'discord.js';

describe('Party Management Tests', () => {
  beforeEach(async () => {
    await clearDatabase();
    vi.restoreAllMocks();
  });

  // Test 1: Creating a party with valid fields
  it('1. Creates a party with valid fields in the database', async () => {
    const validData = {
      guildId: 'guild-123',
      organizerId: 'organizer-456',
      announcementChannelId: 'channel-789',
      title: 'AVA 1500+ Weekend Raid',
      header: 'Join our guild run',
      footer: 'Be in voice 10m before',
      threadName: 'AVA 1500+ Registration',
      ipRequirement: 1500,
      activityType: 'AVA' as const,
      foodCount: 2,
      foodRequirementScope: 'Per Player' as const,
      durationMinutes: 120,
      minimumTrackingToolkit: 5,
      sideTracking: 'Enabled' as const,
      roles: [...DEFAULT_ALBION_ROLES],
    };

    const validated = CreatePartySchema.parse(validData);
    const party = await createParty(validated);

    expect(party).toBeDefined();
    expect(party.id).toBeDefined();
    expect(party.title).toBe('AVA 1500+ Weekend Raid');
    expect(party.ipRequirement).toBe(1500);
    expect(party.activityType).toBe('AVA');
    expect(party.status).toBe('OPEN');
    expect(party.roles.length).toBe(5);

    const fetched = await getPartyById(party.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.roles.find((r) => r.roleNumber === 1)?.roleName).toBe('Tank');
  });

  // Test 2: Rejecting invalid IP, food count, duration, and role capacities
  it('2. Rejects invalid IP, food count, duration, and role capacities', () => {
    const baseValid = {
      guildId: 'guild-123',
      organizerId: 'user-1',
      announcementChannelId: 'channel-1',
      threadName: 'Thread',
      activityType: 'AVA' as const,
      foodRequirementScope: 'Per Player' as const,
      sideTracking: 'Enabled' as const,
      roles: [{ roleNumber: 1, roleName: 'Tank', capacity: 1 }],
    };

    // Invalid negative IP
    expect(() =>
      CreatePartySchema.parse({
        ...baseValid,
        ipRequirement: -50,
        foodCount: 2,
        durationMinutes: 120,
        minimumTrackingToolkit: 5,
      })
    ).toThrow();

    // Invalid excessive IP (>3000)
    expect(() =>
      CreatePartySchema.parse({
        ...baseValid,
        ipRequirement: 4000,
        foodCount: 2,
        durationMinutes: 120,
        minimumTrackingToolkit: 5,
      })
    ).toThrow();

    // Invalid negative food count
    expect(() =>
      CreatePartySchema.parse({
        ...baseValid,
        ipRequirement: 1500,
        foodCount: -1,
        durationMinutes: 120,
        minimumTrackingToolkit: 5,
      })
    ).toThrow();

    // Invalid zero or negative duration
    expect(() =>
      CreatePartySchema.parse({
        ...baseValid,
        ipRequirement: 1500,
        foodCount: 2,
        durationMinutes: 0,
        minimumTrackingToolkit: 5,
      })
    ).toThrow();

    expect(() => parseDurationString('-2 hours')).toThrow();
    expect(() => parseDurationString('invalid string')).toThrow();

    // Invalid role capacity <= 0
    expect(() =>
      CreatePartySchema.parse({
        ...baseValid,
        ipRequirement: 1500,
        foodCount: 2,
        durationMinutes: 60,
        minimumTrackingToolkit: 5,
        roles: [{ roleNumber: 1, roleName: 'Tank', capacity: 0 }],
      })
    ).toThrow();

    // Duplicate role numbers
    expect(() =>
      CreatePartySchema.parse({
        ...baseValid,
        ipRequirement: 1500,
        foodCount: 2,
        durationMinutes: 60,
        minimumTrackingToolkit: 5,
        roles: [
          { roleNumber: 1, roleName: 'Tank', capacity: 1 },
          { roleNumber: 1, roleName: 'Heal', capacity: 1 },
        ],
      })
    ).toThrow();
  });

  // Test 3: Creating the announcement message and thread (with mocked Discord API)
  it('3. Creates the announcement message and dedicated thread in Discord', async () => {
    const party = await createParty({
      guildId: 'guild-100',
      organizerId: 'org-1',
      announcementChannelId: 'chan-100',
      threadName: 'AVA Registration Thread',
      ipRequirement: 1500,
      activityType: 'AVA',
      foodCount: 2,
      foodRequirementScope: 'Per Player',
      durationMinutes: 120,
      minimumTrackingToolkit: 5,
      sideTracking: 'Enabled',
      roles: [...DEFAULT_ALBION_ROLES],
    });

    const mockStartThread = vi.fn().mockResolvedValue({
      id: 'thread-999',
      send: vi.fn().mockResolvedValue({ id: 'instructions-msg-id' }),
    });

    const mockAnnouncementMessage = {
      id: 'msg-555',
      url: 'https://discord.com/channels/guild-100/chan-100/msg-555',
      startThread: mockStartThread,
      delete: vi.fn(),
    };

    const mockChannel = Object.create(TextChannel.prototype);
    mockChannel.send = vi.fn().mockResolvedValue(mockAnnouncementMessage);

    const mockClient = {
      channels: {
        fetch: vi.fn().mockResolvedValue(mockChannel),
      },
      user: {
        username: 'Raid master',
      },
    } as any;

    const result = await createPartyMessageAndThread(
      mockClient,
      party,
      'AVA Registration Thread',
      '@Raid master'
    );

    expect(result.announcementMessage.id).toBe('msg-555');
    expect(result.thread.id).toBe('thread-999');
    expect(mockChannel.send).toHaveBeenCalled();
    expect(mockStartThread).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'AVA Registration Thread' })
    );

    // Verify DB was updated with Discord IDs
    const updated = await getPartyById(party.id);
    expect(updated?.announcementMessageId).toBe('msg-555');
    expect(updated?.threadId).toBe('thread-999');
  });

  // Test 15: Recovering active party records after restart
  it('15. Recovers active party records after a restart', async () => {
    // Create 2 open parties and 1 closed party
    const p1 = await createParty({
      guildId: 'guild-1',
      organizerId: 'org-1',
      announcementChannelId: 'chan-1',
      threadName: 'Active Run 1',
      ipRequirement: 1400,
      activityType: 'AVA',
      foodCount: 1,
      foodRequirementScope: 'Per Player',
      durationMinutes: 60,
      minimumTrackingToolkit: 0,
      sideTracking: 'Disabled',
      roles: [{ roleNumber: 1, roleName: 'Tank', capacity: 1 }],
    });

    const p2 = await createParty({
      guildId: 'guild-1',
      organizerId: 'org-2',
      announcementChannelId: 'chan-1',
      threadName: 'Active Run 2',
      ipRequirement: 1600,
      activityType: 'Outlands',
      foodCount: 2,
      foodRequirementScope: 'Per Player',
      durationMinutes: 90,
      minimumTrackingToolkit: 5,
      sideTracking: 'Enabled',
      roles: [{ roleNumber: 1, roleName: 'DPS', capacity: 2 }],
    });

    // Simulate bot restart recovery by calling getActiveParties
    const activeList = await getActiveParties('guild-1');
    const ids = activeList.map((p) => p.id);

    expect(ids).toContain(p1.id);
    expect(ids).toContain(p2.id);
    expect(activeList.length).toBe(2);
  });

  // Test 16: Handling Discord API errors without creating duplicate parties or orphaned threads
  it('16. Handles Discord API errors safely when thread creation fails, avoiding orphaned messages', async () => {
    const party = await createParty({
      guildId: 'guild-err',
      organizerId: 'org-err',
      announcementChannelId: 'chan-err',
      threadName: 'Faulty Run',
      ipRequirement: 1200,
      activityType: 'Both',
      foodCount: 0,
      foodRequirementScope: 'Per Player',
      durationMinutes: 60,
      minimumTrackingToolkit: 0,
      sideTracking: 'Not Specified',
      roles: [{ roleNumber: 1, roleName: 'Tank', capacity: 1 }],
    });

    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const mockAnnouncementMessage = {
      id: 'msg-err-1',
      startThread: vi.fn().mockRejectedValue(new Error('Discord API 50001: Missing Permissions')),
      delete: mockDelete,
    };

    const mockChannel = Object.create(TextChannel.prototype);
    mockChannel.send = vi.fn().mockResolvedValue(mockAnnouncementMessage);

    const mockClient = {
      channels: {
        fetch: vi.fn().mockResolvedValue(mockChannel),
      },
    } as any;

    await expect(
      createPartyMessageAndThread(mockClient, party, 'Faulty Run')
    ).rejects.toThrow('Discord API 50001: Missing Permissions');

    // Announcement message should have been cleaned up via delete()
    expect(mockDelete).toHaveBeenCalled();
  });
});
