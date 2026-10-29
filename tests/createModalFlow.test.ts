import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearDatabase } from './helpers/testDb';
import {
  handlePartyCreate,
  handleCreateModalSubmit,
  handleCreateButton,
  buildCreatePartyModal,
  activeDrafts,
  getDraftKey,
} from '../src/commands/party/create';
import { getPartyById } from '../src/services/partyService';
import {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  ButtonInteraction,
  TextChannel,
} from 'discord.js';

describe('Create Party Modal Flow Tests', () => {
  const guildId = 'guild-modal-test';
  const userId = 'organizer-user';
  const channelId = 'channel-announcement';

  beforeEach(async () => {
    await clearDatabase();
    activeDrafts.clear();
    vi.restoreAllMocks();
  });

  it('Opens native "Create Party" modal directly without prior channel messages', async () => {
    const mockShowModal = vi.fn().mockResolvedValue(undefined);
    const mockChannel = Object.create(TextChannel.prototype);
    mockChannel.id = channelId;

    const interaction = {
      guildId,
      channelId,
      user: { id: userId },
      options: {
        getChannel: () => mockChannel,
      },
      showModal: mockShowModal,
    } as unknown as ChatInputCommandInteraction;

    await handlePartyCreate(interaction);

    expect(mockShowModal).toHaveBeenCalledOnce();
    const modal = mockShowModal.mock.calls[0][0];

    // Acceptance criterion: Modal titled "Create Party"
    expect(modal.data.title).toBe('Create Party');
    expect(modal.data.custom_id).toBe(`create_party_modal:${channelId}`);

    // Verify 5 input fields (IP, foods, duration, toolkit, thread_name)
    const components = modal.components;
    expect(components.length).toBe(5);

    const customIds = components.map((row: any) => row.components[0].data.custom_id);
    expect(customIds).toContain('ip_requirement');
    expect(customIds).toContain('foods');
    expect(customIds).toContain('duration');
    expect(customIds).toContain('toolkit');
    expect(customIds).toContain('thread_name');

    // Acceptance criterion: Removed Party Header and Party Footer
    expect(customIds).not.toContain('header');
    expect(customIds).not.toContain('footer');
    expect(customIds).not.toContain('title');
  });

  it('Handles modal submission, validates inputs, and responds privately (ephemeral)', async () => {
    const mockReply = vi.fn().mockResolvedValue(undefined);

    const fieldsMap = new Map<string, string>([
      ['ip_requirement', '1600'],
      ['foods', '3'],
      ['duration', '2.5 hours'],
      ['toolkit', '10'],
      ['thread_name', 'AVA 1600+ Weekend Raid'],
    ]);

    const modalInteraction = {
      guildId,
      channelId,
      customId: `create_party_modal:${channelId}`,
      user: { id: userId },
      fields: {
        getTextInputValue: (id: string) => fieldsMap.get(id) || '',
      },
      reply: mockReply,
    } as unknown as ModalSubmitInteraction;

    await handleCreateModalSubmit(modalInteraction);

    expect(mockReply).toHaveBeenCalledOnce();
    const replyArg = mockReply.mock.calls[0][0];
    expect(replyArg.ephemeral).toBe(true);

    // Verify draft was saved with parsed values
    const draft = activeDrafts.get(getDraftKey(userId, guildId));
    expect(draft).toBeDefined();
    expect(draft?.ipRequirement).toBe(1600);
    expect(draft?.foodCount).toBe(3);
    expect(draft?.durationMinutes).toBe(150); // 2.5 hours = 150 mins
    expect(draft?.minimumTrackingToolkit).toBe(10);
    expect(draft?.threadName).toBe('AVA 1600+ Weekend Raid');
    expect(draft?.activityType).toBe('AVA');
    expect(draft?.sideTracking).toBe('Enabled');
  });

  it('Completes party creation upon clicking Create Party button', async () => {
    // Setup pre-existing draft from modal submit
    activeDrafts.set(getDraftKey(userId, guildId), {
      guildId,
      organizerId: userId,
      announcementChannelId: channelId,
      ipRequirement: 1500,
      durationMinutes: 120,
      foodCount: 2,
      minimumTrackingToolkit: 5,
      threadName: 'AVA 1500+ Registration',
      activityType: 'AVA',
      sideTracking: 'Enabled',
      roles: [
        { roleNumber: 1, roleName: 'Tank', capacity: 1 },
        { roleNumber: 2, roleName: 'Heal', capacity: 1 },
      ],
    });

    const mockStartThread = vi.fn().mockResolvedValue({
      id: 'thread-final-123',
      send: vi.fn().mockResolvedValue({ id: 'msg-inst' }),
    });

    const mockAnnouncementMessage = {
      id: 'msg-final-123',
      url: 'https://discord.com/channels/guild/channel/msg',
      startThread: mockStartThread,
      delete: vi.fn(),
    };

    const mockChannel = Object.create(TextChannel.prototype);
    mockChannel.send = vi.fn().mockResolvedValue(mockAnnouncementMessage);

    const mockClient = {
      channels: {
        fetch: vi.fn().mockResolvedValue(mockChannel),
      },
      user: { username: 'Party Raid' },
    } as any;

    const mockDeferUpdate = vi.fn().mockResolvedValue(undefined);
    const mockEditReply = vi.fn().mockResolvedValue(undefined);

    const buttonInteraction = {
      guildId,
      customId: 'create_btn_submit',
      user: { id: userId },
      client: mockClient,
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
    } as unknown as ButtonInteraction;

    await handleCreateButton(buttonInteraction);

    expect(mockDeferUpdate).toHaveBeenCalledOnce();
    expect(mockChannel.send).toHaveBeenCalledOnce();
    expect(mockStartThread).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'AVA 1500+ Registration' })
    );
    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Party Created Successfully'),
      })
    );

    // Draft should be cleaned up
    expect(activeDrafts.has(getDraftKey(userId, guildId))).toBe(false);
  });
});
