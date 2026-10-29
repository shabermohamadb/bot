import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearDatabase } from './helpers/testDb';
import {
  handlePartyCreate,
  handleCreateModalStep1Submit,
  handleOpenStep2Button,
  handleCreateModalStep2Submit,
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

  it('Step 1: Opens native "Create Party" modal directly without prior channel messages', async () => {
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

    // Modal titled "Create Party"
    expect(modal.data.title).toBe('Create Party');
    expect(modal.data.custom_id).toBe(`create_modal_step1:${channelId}`);

    // Verify 5 input fields (IP, activity, foods, duration, toolkit)
    const components = modal.components;
    expect(components.length).toBe(5);

    const customIds = components.map((row: any) => row.components[0].data.custom_id);
    expect(customIds).toContain('ip_requirement');
    expect(customIds).toContain('activity_type');
    expect(customIds).toContain('foods');
    expect(customIds).toContain('duration');
    expect(customIds).toContain('toolkit');

    // Removed Party Header and Party Footer
    expect(customIds).not.toContain('header');
    expect(customIds).not.toContain('footer');
  });

  it('Step 1 Submit: Validates inputs, saves draft, and prompts with Step 2 button (no summary embed)', async () => {
    const mockReply = vi.fn().mockResolvedValue(undefined);

    const fieldsMap = new Map<string, string>([
      ['ip_requirement', '1600'],
      ['activity_type', 'AVA'],
      ['foods', '3'],
      ['duration', '2.5 hours'],
      ['toolkit', '10'],
    ]);

    const modalInteraction = {
      guildId,
      channelId,
      customId: `create_modal_step1:${channelId}`,
      user: { id: userId },
      fields: {
        getTextInputValue: (id: string) => fieldsMap.get(id) || '',
      },
      reply: mockReply,
    } as unknown as ModalSubmitInteraction;

    await handleCreateModalStep1Submit(modalInteraction);

    expect(mockReply).toHaveBeenCalledOnce();
    const replyArg = mockReply.mock.calls[0][0];
    expect(replyArg.ephemeral).toBe(true);
    // Crucial: No summary embed or wizard embed
    expect(replyArg.embeds).toBeUndefined();

    // Verify draft was saved
    const draft = activeDrafts.get(getDraftKey(userId, guildId));
    expect(draft).toBeDefined();
    expect(draft?.ipRequirement).toBe(1600);
    expect(draft?.activityType).toBe('AVA');
    expect(draft?.foodCount).toBe(3);
    expect(draft?.durationMinutes).toBe(150);
    expect(draft?.minimumTrackingToolkit).toBe(10);
  });

  it('Step 2: Opens Step 2 Modal asking for Side Tracking, Roles, and Thread Name', async () => {
    // Populate draft from step 1
    activeDrafts.set(getDraftKey(userId, guildId), {
      guildId,
      organizerId: userId,
      announcementChannelId: channelId,
      ipRequirement: 1600,
      activityType: 'AVA',
      foodCount: 3,
      durationMinutes: 150,
      minimumTrackingToolkit: 10,
    });

    const mockShowModal = vi.fn().mockResolvedValue(undefined);

    const btnInteraction = {
      guildId,
      customId: `create_btn_open_step2:${channelId}`,
      user: { id: userId },
      showModal: mockShowModal,
    } as unknown as ButtonInteraction;

    await handleOpenStep2Button(btnInteraction);

    expect(mockShowModal).toHaveBeenCalledOnce();
    const modal = mockShowModal.mock.calls[0][0];
    expect(modal.data.custom_id).toBe(`create_modal_step2:${channelId}`);

    const customIds = modal.components.map((row: any) => row.components[0].data.custom_id);
    expect(customIds).toContain('party_name');
    expect(customIds).toContain('side_tracking');
    expect(customIds).toContain('roles');
    expect(customIds).toContain('thread_name');
  });

  it('Step 2 Submit: Completes party creation without setup summaries, publishing announcement and thread', async () => {
    // Populate draft from step 1
    activeDrafts.set(getDraftKey(userId, guildId), {
      guildId,
      organizerId: userId,
      announcementChannelId: channelId,
      ipRequirement: 1500,
      activityType: 'AVA',
      foodCount: 2,
      durationMinutes: 120,
      minimumTrackingToolkit: 5,
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

    const mockDeferReply = vi.fn().mockResolvedValue(undefined);
    const mockEditReply = vi.fn().mockResolvedValue(undefined);

    const fieldsMap = new Map<string, string>([
      ['party_name', 'BLACK ZONE TRACKING'],
      ['side_tracking', 'Enabled'],
      ['roles', '1: Tank (1), 2: Heal (1), 3: DPS Cultist (2)'],
      ['thread_name', 'AVA 1500+ Official Run'],
    ]);

    const modal2Interaction = {
      guildId,
      customId: `create_modal_step2:${channelId}`,
      user: { id: userId },
      client: mockClient,
      fields: {
        getTextInputValue: (id: string) => fieldsMap.get(id) || '',
      },
      deferReply: mockDeferReply,
      editReply: mockEditReply,
      replied: true,
    } as unknown as ModalSubmitInteraction;

    await handleCreateModalStep2Submit(modal2Interaction);

    expect(mockDeferReply).toHaveBeenCalledOnce();
    expect(mockChannel.send).toHaveBeenCalledOnce();
    expect(mockStartThread).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'AVA 1500+ Official Run' })
    );

    // Draft should be cleaned up
    expect(activeDrafts.has(getDraftKey(userId, guildId))).toBe(false);

    // Verify custom party name was saved to database
    const created = await prisma.party.findFirst();
    expect(created?.title).toBe('BLACK ZONE TRACKING');
  });
});
