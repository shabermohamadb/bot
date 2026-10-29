import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearDatabase } from './helpers/testDb';
import { createParty, getPartyById } from '../src/services/partyService';
import { handleMessageCreate } from '../src/events/messageCreate';
import { DEFAULT_ALBION_ROLES } from '../src/validation/partySchemas';
import { Message, ThreadChannel } from 'discord.js';

describe('End-to-End Thread Message Event Tests', () => {
  let partyId: string;
  const guildId = 'guild-e2e';
  const threadId = 'thread-e2e-123';
  const botUserId = 'bot-user-id';

  beforeEach(async () => {
    await clearDatabase();
    vi.restoreAllMocks();

    const party = await createParty({
      guildId,
      organizerId: 'org-e2e',
      announcementChannelId: 'channel-e2e',
      threadName: 'E2E Registration Thread',
      ipRequirement: 1500,
      activityType: 'AVA',
      foodCount: 2,
      foodRequirementScope: 'Per Player',
      durationMinutes: 120,
      minimumTrackingToolkit: 5,
      sideTracking: 'Enabled',
      roles: [...DEFAULT_ALBION_ROLES],
    });

    // Simulate thread ID linked to party
    await (await import('../src/database/client')).prisma.party.update({
      where: { id: party.id },
      data: {
        announcementMessageId: 'msg-e2e-announcement',
        threadId: threadId,
      },
    });

    partyId = party.id;
  });

  function createMockMessage(authorId: string, content: string) {
    const mockReply = vi.fn().mockResolvedValue({ id: 'reply-msg' });

    const mockChannel = Object.create(ThreadChannel.prototype);
    mockChannel.id = threadId;
    mockChannel.isThread = () => true;

    const mockClient = {
      user: { id: botUserId, username: 'Raid master' },
      channels: {
        fetch: vi.fn().mockResolvedValue(null),
      },
    } as any;

    const message = {
      author: { id: authorId, bot: false },
      guild: { id: guildId },
      channel: mockChannel,
      content,
      reply: mockReply,
      client: mockClient,
    } as unknown as Message;

    return { message, mockReply };
  }

  it('Registers user when sending bot mention with role number in thread', async () => {
    const { message, mockReply } = createMockMessage('player-1', `<@${botUserId}> 1`);

    await handleMessageCreate(message);

    expect(mockReply).toHaveBeenCalled();
    const replyContent = mockReply.mock.calls[0][0].content;
    expect(replyContent).toContain('Registered for **Role 1 (Tank)**');

    const party = await getPartyById(partyId);
    const role1 = party?.roles.find((r) => r.roleNumber === 1);
    expect(role1?.registrations.map((r) => r.userId)).toContain('player-1');
  });

  it('Switches user role when sending a new role number in thread', async () => {
    // Register role 1 first
    const { message: msg1 } = createMockMessage('player-2', `<@${botUserId}> 1`);
    await handleMessageCreate(msg1);

    // Switch to role 3 (DPS Cultist)
    const { message: msg2, mockReply: reply2 } = createMockMessage('player-2', `<@${botUserId}> 3`);
    await handleMessageCreate(msg2);

    expect(reply2).toHaveBeenCalled();
    const replyContent = reply2.mock.calls[0][0].content;
    expect(replyContent).toContain('Switched from **Tank** to **Role 3 (DPS Cultist)**');

    const party = await getPartyById(partyId);
    const role1 = party?.roles.find((r) => r.roleNumber === 1);
    const role3 = party?.roles.find((r) => r.roleNumber === 3);
    expect(role1?.registrations.length).toBe(0);
    expect(role3?.registrations.map((r) => r.userId)).toContain('player-2');
  });

  it('Unregisters user when sending "-" in thread', async () => {
    // Register
    const { message: msg1 } = createMockMessage('player-3', `<@${botUserId}> 2`);
    await handleMessageCreate(msg1);

    // Unregister with bot mention: <@botId> -
    const { message: msg2, mockReply: reply2 } = createMockMessage('player-3', `<@${botUserId}> -`);
    await handleMessageCreate(msg2);

    expect(reply2).toHaveBeenCalled();
    const replyContent = reply2.mock.calls[0][0].content;
    expect(replyContent).toContain('You have unregistered from **Heal**');

    const party = await getPartyById(partyId);
    const role2 = party?.roles.find((r) => r.roleNumber === 2);
    expect(role2?.registrations.length).toBe(0);
  });

  it('Ignores casual discussion in thread not directed at the bot', async () => {
    const { message, mockReply } = createMockMessage('player-chat', 'Is someone bringing a skip set?');

    await handleMessageCreate(message);

    expect(mockReply).not.toHaveBeenCalled();
  });
});

