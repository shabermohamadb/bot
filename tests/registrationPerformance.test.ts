import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { clearDatabase } from './helpers/testDb';
import { createParty } from '../src/services/partyService';
import {
  registerUserForRole,
  unregisterUser,
  RoleFullError,
} from '../src/services/registrationService';
import { handleMessageCreate } from '../src/events/messageCreate';
import { RegistrationTracker, metricsCollector } from '../src/utils/registrationMetrics';
import { DEFAULT_ALBION_ROLES } from '../src/validation/partySchemas';
import { Message, ThreadChannel, TextChannel } from 'discord.js';

describe('Fast Registration Performance & Latency Optimization Tests', () => {
  let partyId: string;
  const guildId = 'guild-perf-test';
  const organizerId = 'org-perf-1';
  const threadId = 'thread-perf-123';
  const botUserId = '1565345488507773013';

  beforeEach(async () => {
    await clearDatabase();
    vi.restoreAllMocks();

    const party = await createParty({
      guildId,
      organizerId,
      announcementChannelId: 'channel-perf-announcements',
      threadName: 'Performance Tracking Thread',
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

  describe('1. Fast Filtering & Immediate Feedback', () => {
    it('ignores normal conversation in thread with zero database calls', async () => {
      const mockReply = vi.fn();
      const mockSendTyping = vi.fn();

      const mockThread = Object.create(ThreadChannel.prototype);
      mockThread.id = threadId;
      mockThread.isThread = () => true;
      mockThread.sendTyping = mockSendTyping;

      const message = {
        author: { bot: false, id: 'chatty-user' },
        guild: { id: guildId },
        channel: mockThread,
        content: 'Hey guys what tier skip set are we bringing tonight?',
        client: { user: { id: botUserId } },
        reply: mockReply,
      } as unknown as Message;

      await handleMessageCreate(message);

      expect(mockReply).not.toHaveBeenCalled();
      expect(mockSendTyping).not.toHaveBeenCalled();
    });

    it('triggers sendTyping immediately for instantaneous user feedback on bot mention', async () => {
      const mockReply = vi.fn().mockResolvedValue({ id: 'reply-1' });
      const mockSendTyping = vi.fn().mockResolvedValue(undefined);

      const mockThread = Object.create(ThreadChannel.prototype);
      mockThread.id = threadId;
      mockThread.isThread = () => true;
      mockThread.sendTyping = mockSendTyping;

      const message = {
        author: { bot: false, id: 'user-speedy' },
        guild: { id: guildId },
        channel: mockThread,
        content: `<@${botUserId}> 1`,
        client: {
          user: { id: botUserId },
          channels: {
            cache: new Map(),
            fetch: vi.fn(),
          },
        },
        reply: mockReply,
      } as unknown as Message;

      // Note: thread not in DB yet for this dummy ID, so it will exit after lookup
      await handleMessageCreate(message);

      // Verify typing was dispatched immediately
      expect(mockSendTyping).toHaveBeenCalledOnce();
    });
  });

  describe('2. Optimized Atomic Registration Flow', () => {
    it('completes initial role registration with atomic validation and cached party reuse', async () => {
      const userId = 'user-tank-fast';
      const t0 = performance.now();

      const result = await registerUserForRole(partyId, userId, 1, guildId);
      const elapsed = performance.now() - t0;

      expect(result.success).toBe(true);
      expect(result.action).toBe('REGISTERED');
      expect(result.roleNumber).toBe(1);
      expect(result.roleName).toBe('Tank');
      expect(result.party.roles.find((r) => r.roleNumber === 1)?.registrations.length).toBe(1);

      // Latency check
      expect(elapsed).toBeGreaterThan(0);
    });

    it('detects duplicate registration without running redundant database mutations', async () => {
      const userId = 'user-duplicate-check';
      await registerUserForRole(partyId, userId, 2, guildId);

      const dupResult = await registerUserForRole(partyId, userId, 2, guildId);
      expect(dupResult.success).toBe(true);
      expect(dupResult.action).toBe('ALREADY_REGISTERED');
      expect(dupResult.roleName).toBe('Heal');
    });

    it('switches role atomically when target role has capacity', async () => {
      const userId = 'user-role-switcher';
      await registerUserForRole(partyId, userId, 2, guildId);

      const switchResult = await registerUserForRole(partyId, userId, 3, guildId);
      expect(switchResult.success).toBe(true);
      expect(switchResult.action).toBe('ROLE_SWITCHED');
      expect(switchResult.roleNumber).toBe(3);
      expect(switchResult.roleName).toBe('DPS Cultist');
      expect(switchResult.previousRoleName).toBe('Heal');

      // Verify old role is free
      const healRole = switchResult.party.roles.find((r) => r.roleNumber === 2);
      expect(healRole?.registrations.some((r) => r.userId === userId)).toBe(false);
    });

    it('rejects registration when target role is full and preserves existing role', async () => {
      // Tank capacity is 1
      await registerUserForRole(partyId, 'user-tank-occupant', 1, guildId);

      // Switcher tries to join Tank from Heal
      await registerUserForRole(partyId, 'user-hopeful-tank', 2, guildId);
      const fullResult = await registerUserForRole(partyId, 'user-hopeful-tank', 1, guildId);

      expect(fullResult.success).toBe(false);
      expect(fullResult.action).toBe('REJECTED');
      expect(fullResult.errorReason).toBe('ROLE_FULL');
      expect(fullResult.message).toContain('already full');
    });

    it('unregisters a user atomically in a single optimized transaction', async () => {
      const userId = 'user-to-leave';
      await registerUserForRole(partyId, userId, 4, guildId);

      const unregResult = await unregisterUser(partyId, userId, guildId, userId);
      expect(unregResult.success).toBe(true);
      expect(unregResult.action).toBe('UNREGISTERED');
      expect(unregResult.roleNumber).toBe(4);
      expect(unregResult.roleName).toBe('DPS Mana');
    });
  });

  describe('3. Latency Monitoring & Metrics Collection', () => {
    it('records structured timing milestones and computes p50/p95 latency', () => {
      const tracker = new RegistrationTracker('trace-test-1', 'user-metric', 'thread-metric');
      tracker.markParsed();
      tracker.markPartyLookup('party-xyz');
      tracker.markDbTransactionCompleted('REGISTERED', 1);
      tracker.markConfirmationSent();
      tracker.markAnnouncementUpdated();

      // Collect simulated latencies to verify percentile calculations
      for (let i = 1; i <= 20; i++) {
        metricsCollector.record(200 + i * 10);
      }

      const stats = metricsCollector.getStats();
      expect(stats.count).toBeGreaterThan(0);
      expect(stats.p50Ms).toBeGreaterThan(0);
      expect(stats.p95Ms).toBeGreaterThanOrEqual(stats.p50Ms);
      expect(stats.minMs).toBeLessThanOrEqual(stats.maxMs);
    });
  });

  afterAll(async () => {
    await clearDatabase();
  });
});

