import { describe, it, expect, beforeAll, vi } from 'vitest';
import { clearDatabase } from './helpers/testDb';
import { createParty } from '../src/services/partyService';
import { handleMessageCreate } from '../src/events/messageCreate';
import { DEFAULT_ALBION_ROLES } from '../src/validation/partySchemas';

describe('Dual Registration Flows (Bot Mention & Reply-Based)', () => {
  const guildId = 'guild-dual-reg';
  const organizerId = 'org-user-1';
  const threadId = 'thread-party-123';
  const botUserId = '1565345488507773013';

  let partyId: string;

  beforeAll(async () => {
    await clearDatabase();

    const party = await createParty({
      guildId,
      organizerId,
      announcementChannelId: 'announcement-channel-1',
      threadName: 'AVA Expedition Thread',
      ipRequirement: 1500,
      activityType: 'AVA',
      foodCount: 2,
      foodRequirementScope: 'Per Player',
      durationMinutes: 90,
      minimumTrackingToolkit: 5,
      sideTracking: 'Enabled',
      roles: [...DEFAULT_ALBION_ROLES],
    });

    partyId = party.id;

    // Attach threadId to party in DB
    const { prisma } = await import('../src/database/client');
    await prisma.party.update({
      where: { id: partyId },
      data: { threadId },
    });
  });

  afterEach(async () => {
    const { prisma } = await import('../src/database/client');
    await prisma.partyRegistration.deleteMany({
      where: { partyId },
    });
  });

  function createMockMessage(opts: {
    content: string;
    userId?: string;
    isThread?: boolean;
    reference?: { messageId: string } | null;
    repliedUserId?: string | null;
  }) {
    const userId = opts.userId || 'player-1';
    const isThread = opts.isThread !== undefined ? opts.isThread : true;
    const replyMock = vi.fn().mockResolvedValue({});
    const typingMock = vi.fn().mockResolvedValue({});

    return {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content: opts.content,
      author: {
        id: userId,
        bot: false,
      },
      guild: { id: guildId },
      channel: {
        id: threadId,
        isThread: () => isThread,
        sendTyping: typingMock,
        messages: {
          cache: {
            get: (id: string) => {
              if (opts.repliedUserId) {
                return { id, author: { id: opts.repliedUserId } };
              }
              return null;
            },
          },
          fetch: vi.fn().mockImplementation((id: string) => {
            if (opts.repliedUserId) {
              return Promise.resolve({ id, author: { id: opts.repliedUserId } });
            }
            return Promise.reject(new Error('Unknown message'));
          }),
        },
      },
      client: {
        user: {
          id: botUserId,
          username: 'Party Raid',
          tag: 'Party Raid#9161',
        },
      },
      reference: opts.reference || null,
      mentions: {
        repliedUser: opts.repliedUserId ? { id: opts.repliedUserId } : null,
      },
      fetchReference: vi.fn().mockResolvedValue(
        opts.repliedUserId ? { author: { id: opts.repliedUserId } } : null
      ),
      reply: replyMock,
    } as any;
  }

  describe('Method 1: Bot Mention Registration Flow', () => {
    it('Registers player when mentioning the bot: <@botId> 1 (Tank)', async () => {
      const msg = createMockMessage({
        content: `<@${botUserId}> 1`,
        userId: 'player-tank',
      });

      await handleMessageCreate(msg);

      expect(msg.reply).toHaveBeenCalledTimes(1);
      const replyArg = msg.reply.mock.calls[0][0];
      expect(replyArg.content).toContain('REGISTRATION CONFIRMED');
      expect(replyArg.content).toContain('Tank');
    });

    it('Registers player using alias mention: @Party Raid 2 (Heal)', async () => {
      const msg = createMockMessage({
        content: '@Party Raid 2',
        userId: 'player-heal',
      });

      await handleMessageCreate(msg);

      expect(msg.reply).toHaveBeenCalledTimes(1);
      const replyArg = msg.reply.mock.calls[0][0];
      expect(replyArg.content).toContain('REGISTRATION CONFIRMED');
      expect(replyArg.content).toContain('Heal');
    });

    it('Switches role atomically when mentioning bot with a different role: @Party Raid 3', async () => {
      // First register as role 2
      const msg1 = createMockMessage({
        content: '@Party Raid 2',
        userId: 'player-switcher',
      });
      await handleMessageCreate(msg1);

      // Switch to role 3 (DPS Cultist)
      const msg2 = createMockMessage({
        content: '@Party Raid 3',
        userId: 'player-switcher',
      });
      await handleMessageCreate(msg2);

      expect(msg2.reply).toHaveBeenCalledTimes(1);
      const replyArg = msg2.reply.mock.calls[0][0];
      expect(replyArg.content).toContain('ROLE UPDATED');
      expect(replyArg.content).toContain('DPS Cultist');
    });

    it('Unregisters player when mentioning bot with "-": @Party Raid -', async () => {
      // First register
      const msg1 = createMockMessage({
        content: '@Party Raid 1',
        userId: 'player-unreg',
      });
      await handleMessageCreate(msg1);

      // Unregister
      const msg2 = createMockMessage({
        content: '@Party Raid -',
        userId: 'player-unreg',
      });
      await handleMessageCreate(msg2);

      expect(msg2.reply).toHaveBeenCalledTimes(1);
      const replyArg = msg2.reply.mock.calls[0][0];
      expect(replyArg.content).toContain('REGISTRATION REMOVED');
    });
  });

  describe('Method 2: Reply-Based Registration Flow', () => {
    it('Registers player when replying to bot message with "1" (Tank)', async () => {
      const msg = createMockMessage({
        content: '1',
        userId: 'reply-tank',
        reference: { messageId: 'bot-announcement-msg' },
        repliedUserId: botUserId,
      });

      await handleMessageCreate(msg);

      expect(msg.reply).toHaveBeenCalledTimes(1);
      const replyArg = msg.reply.mock.calls[0][0];
      expect(replyArg.content).toContain('REGISTRATION CONFIRMED');
      expect(replyArg.content).toContain('Tank');
    });

    it('Registers player when replying to bot message with "#2" (Heal)', async () => {
      const msg = createMockMessage({
        content: '#2',
        userId: 'reply-heal',
        reference: { messageId: 'bot-announcement-msg' },
        repliedUserId: botUserId,
      });

      await handleMessageCreate(msg);

      expect(msg.reply).toHaveBeenCalledTimes(1);
      const replyArg = msg.reply.mock.calls[0][0];
      expect(replyArg.content).toContain('REGISTRATION CONFIRMED');
      expect(replyArg.content).toContain('Heal');
    });

    it('Switches role atomically when replying with "4" (DPS Mana)', async () => {
      // First register as 2
      const msg1 = createMockMessage({
        content: '2',
        userId: 'reply-switcher',
        reference: { messageId: 'bot-announcement-msg' },
        repliedUserId: botUserId,
      });
      await handleMessageCreate(msg1);

      // Switch to 4
      const msg2 = createMockMessage({
        content: '4',
        userId: 'reply-switcher',
        reference: { messageId: 'bot-announcement-msg' },
        repliedUserId: botUserId,
      });
      await handleMessageCreate(msg2);

      expect(msg2.reply).toHaveBeenCalledTimes(1);
      const replyArg = msg2.reply.mock.calls[0][0];
      expect(replyArg.content).toContain('ROLE UPDATED');
      expect(replyArg.content).toContain('DPS Mana');
    });

    it('Unregisters player when replying to bot message with "-"', async () => {
      // First register
      const msg1 = createMockMessage({
        content: '5',
        userId: 'reply-unreg-user',
        reference: { messageId: 'bot-announcement-msg' },
        repliedUserId: botUserId,
      });
      await handleMessageCreate(msg1);

      // Unregister by replying with "-"
      const msg2 = createMockMessage({
        content: '-',
        userId: 'reply-unreg-user',
        reference: { messageId: 'bot-announcement-msg' },
        repliedUserId: botUserId,
      });
      await handleMessageCreate(msg2);

      expect(msg2.reply).toHaveBeenCalledTimes(1);
      const replyArg = msg2.reply.mock.calls[0][0];
      expect(replyArg.content).toContain('REGISTRATION REMOVED');
    });
  });

  describe('Protection: Discarding Ordinary and Unrelated Messages', () => {
    it('Ignores standalone numbers sent as ordinary messages without replying to bot', async () => {
      const msg = createMockMessage({
        content: '1',
        userId: 'random-user',
        reference: null,
      });

      await handleMessageCreate(msg);

      expect(msg.reply).not.toHaveBeenCalled();
      expect(msg.channel.sendTyping).not.toHaveBeenCalled();
    });

    it('Ignores standalone numbers when replying to another user (not the bot)', async () => {
      const msg = createMockMessage({
        content: '1',
        userId: 'random-user',
        reference: { messageId: 'other-user-msg' },
        repliedUserId: '999999999999999999', // Another human user
      });

      await handleMessageCreate(msg);

      expect(msg.reply).not.toHaveBeenCalled();
      expect(msg.channel.sendTyping).not.toHaveBeenCalled();
    });

    it('Ignores unrelated numbers (>9) like IP values in replies to bot: "1500"', async () => {
      const msg = createMockMessage({
        content: '1500',
        userId: 'ip-talker',
        reference: { messageId: 'bot-announcement-msg' },
        repliedUserId: botUserId,
      });

      await handleMessageCreate(msg);

      expect(msg.reply).not.toHaveBeenCalled();
      expect(msg.channel.sendTyping).not.toHaveBeenCalled();
    });

    it('Ignores conversational chatter in thread', async () => {
      const msg = createMockMessage({
        content: 'Hey everyone, please bring tier 8 gear!',
        userId: 'caller',
      });

      await handleMessageCreate(msg);

      expect(msg.reply).not.toHaveBeenCalled();
    });

    it('Rejects role number out of range (0 or 6) with clear error message', async () => {
      const msg = createMockMessage({
        content: '6',
        userId: 'out-of-range-user',
        reference: { messageId: 'bot-announcement-msg' },
        repliedUserId: botUserId,
      });

      await handleMessageCreate(msg);

      expect(msg.reply).toHaveBeenCalledTimes(1);
      const replyArg = msg.reply.mock.calls[0][0];
      expect(replyArg.content).toContain('INVALID ROLE');
      expect(replyArg.content).toContain('Role number must be between 1 and 5');
    });
  });
});
