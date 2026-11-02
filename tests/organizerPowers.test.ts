import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { clearDatabase } from './helpers/testDb';
import { createParty } from '../src/services/partyService';
import { handleMessageCreate } from '../src/events/messageCreate';
import { organizerAssignRole, registerUserForRole } from '../src/services/registrationService';
import { DEFAULT_ALBION_ROLES } from '../src/validation/partySchemas';
import { prisma } from '../src/database/client';

describe('Organizer Registration Management Powers (@Raid Master +<role> @user & -<role> @user)', { timeout: 30000 }, () => {
  const guildId = 'guild-organizer-powers';
  const hostUserId = 'host-user-1';
  const otherHostId = 'host-user-2';
  const normalUserId = 'normal-user-1';
  const targetMemberId = 'target-shaber-1';

  const threadIdPartyA = 'thread-party-a';
  const threadIdPartyB = 'thread-party-b';
  const botUserId = '1565345488507773013';

  let partyAId: string;
  let partyBId: string;

  beforeAll(async () => {
    await clearDatabase();

    // Create Party A and Party B in parallel
    const [partyA, partyB] = await Promise.all([
      createParty({
        guildId,
        organizerId: hostUserId,
        announcementChannelId: 'channel-test-1',
        threadName: 'AVA Expedition Party A',
        ipRequirement: 1500,
        activityType: 'AVA',
        foodCount: 2,
        foodRequirementScope: 'Per Player',
        durationMinutes: 90,
        minimumTrackingToolkit: 5,
        sideTracking: 'Enabled',
        roles: [...DEFAULT_ALBION_ROLES],
      }),
      createParty({
        guildId,
        organizerId: otherHostId,
        announcementChannelId: 'channel-test-1',
        threadName: 'Outlands Run Party B',
        ipRequirement: 1400,
        activityType: 'Outlands',
        foodCount: 1,
        foodRequirementScope: 'Per Player',
        durationMinutes: 60,
        minimumTrackingToolkit: 2,
        sideTracking: 'Disabled',
        roles: [...DEFAULT_ALBION_ROLES],
      }),
    ]);

    partyAId = partyA.id;
    partyBId = partyB.id;

    await Promise.all([
      prisma.party.update({
        where: { id: partyAId },
        data: { threadId: threadIdPartyA },
      }),
      prisma.party.update({
        where: { id: partyBId },
        data: { threadId: threadIdPartyB },
      }),
    ]);
  }, 90000);

  afterEach(async () => {
    // Clear test party registrations between runs
    await prisma.partyRegistration.deleteMany({
      where: { partyId: { in: [partyAId, partyBId] } },
    });
  });

  function createMockMessage(opts: {
    content: string;
    authorId: string;
    threadId?: string;
    targetUser?: { id: string; bot?: boolean } | null;
  }) {
    const thread = opts.threadId || threadIdPartyA;
    let repliedContent = '';
    const replyMock = vi.fn().mockImplementation((payload: any) => {
      repliedContent = typeof payload === 'string' ? payload : payload.content;
      return Promise.resolve({ id: `reply-${Date.now()}` });
    });
    const typingMock = vi.fn().mockResolvedValue({});

    const mentionedUsersMap = new Map<string, any>();
    if (opts.targetUser) {
      mentionedUsersMap.set(opts.targetUser.id, {
        id: opts.targetUser.id,
        bot: Boolean(opts.targetUser.bot),
        username: `User-${opts.targetUser.id}`,
      });
    }

    const mockMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content: opts.content,
      author: {
        id: opts.authorId,
        bot: false,
      },
      guild: { id: guildId, ownerId: 'guild-owner-999' },
      channel: {
        id: thread,
        isThread: () => true,
        sendTyping: typingMock,
        messages: {
          cache: { get: () => null },
          fetch: vi.fn().mockRejectedValue(new Error('No ref message')),
        },
      },
      member: {
        id: opts.authorId,
        guild: { id: guildId, ownerId: 'guild-owner-999' },
        permissions: {
          has: () => false, // Regular non-admin member by default
        },
        roles: {
          cache: new Map(),
        },
      },
      client: {
        user: {
          id: botUserId,
          username: 'Party Raid',
          tag: 'Party Raid#9161',
        },
      },
      reference: null,
      mentions: {
        repliedUser: null,
        users: {
          get: (id: string) => mentionedUsersMap.get(id),
          find: (fn: (u: any) => boolean) => {
            for (const u of mentionedUsersMap.values()) {
              if (fn(u)) return u;
            }
            return undefined;
          },
          filter: (fn: (u: any) => boolean) => {
            const res = new Map();
            for (const [k, v] of mentionedUsersMap) {
              if (fn(v)) res.set(k, v);
            }
            return res;
          },
        },
      },
      reply: replyMock,
      getRepliedContent: () => repliedContent,
    } as any;

    return mockMessage;
  }

  // 1. Host assigns a new member to role 2
  it('1. Host assigns a new member to role 2: @Raid Master +2 @Shaber', async () => {
    const msg = createMockMessage({
      content: `@Raid Master +2 <@${targetMemberId}>`,
      authorId: hostUserId,
      targetUser: { id: targetMemberId },
    });

    await handleMessageCreate(msg);

    const reply = msg.getRepliedContent();
    expect(reply).toContain(`<@${targetMemberId}> has been assigned to HEAL by <@${hostUserId}>`);

    // Verify database record
    const reg = await prisma.partyRegistration.findUnique({
      where: { partyId_userId: { partyId: partyAId, userId: targetMemberId } },
      include: { role: true },
    });
    expect(reg).not.toBeNull();
    expect(reg?.role.roleNumber).toBe(2);
    expect(reg?.role.roleName).toBe('Heal');

    // Verify audit log
    const audit = await prisma.auditLog.findFirst({
      where: { partyId: partyAId, actorId: hostUserId, action: 'ORGANIZER_ASSIGN' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.newValue).toContain('Role 2 (Heal)');
  });

  // 2. Host moves a member from role 1 to role 2
  it('2. Host moves a member from role 1 to role 2 atomically', async () => {
    // First, register target member in role 1 (Tank)
    await registerUserForRole(partyAId, targetMemberId, 1, guildId);

    const initialReg = await prisma.partyRegistration.findUnique({
      where: { partyId_userId: { partyId: partyAId, userId: targetMemberId } },
      include: { role: true },
    });
    expect(initialReg?.role.roleNumber).toBe(1);

    // Host moves them to role 2 (Heal)
    const msg = createMockMessage({
      content: `@Party Raid +2 <@${targetMemberId}>`,
      authorId: hostUserId,
      targetUser: { id: targetMemberId },
    });

    await handleMessageCreate(msg);

    const reply = msg.getRepliedContent();
    expect(reply).toContain(`<@${targetMemberId}> has been assigned to HEAL by <@${hostUserId}>`);

    // Verify user is only registered in role 2 and NOT role 1
    const allRegs = await prisma.partyRegistration.findMany({
      where: { partyId: partyAId, userId: targetMemberId },
      include: { role: true },
    });
    expect(allRegs).toHaveLength(1);
    expect(allRegs[0].role.roleNumber).toBe(2);

    // Verify audit log recorded previous role
    const audit = await prisma.auditLog.findFirst({
      where: { partyId: partyAId, actorId: hostUserId, action: 'ORGANIZER_MOVE' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.previousValue).toContain('Role 1 (Tank)');
    expect(audit?.newValue).toContain('Role 2 (Heal)');
  });

  // 3. Host removes a member from role 5
  it('3. Host removes a member from role 5: @Raid Master -5 @user', async () => {
    // Register target member in role 5 (DPS Stalker)
    await registerUserForRole(partyAId, targetMemberId, 5, guildId);

    const msg = createMockMessage({
      content: `@Raid Master -5 <@${targetMemberId}>`,
      authorId: hostUserId,
      targetUser: { id: targetMemberId },
    });

    await handleMessageCreate(msg);

    const reply = msg.getRepliedContent();
    expect(reply).toContain(`<@${targetMemberId}> has been removed from DPS STALKER by <@${hostUserId}>`);

    // Verify user was removed from party
    const reg = await prisma.partyRegistration.findUnique({
      where: { partyId_userId: { partyId: partyAId, userId: targetMemberId } },
    });
    expect(reg).toBeNull();

    // Verify audit log
    const audit = await prisma.auditLog.findFirst({
      where: { partyId: partyAId, actorId: hostUserId, action: 'ORGANIZER_REMOVE' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.previousValue).toContain('Role 5 (DPS Stalker)');
  });

  it('3b. Host tries removing user from role 5 but user is registered in role 1 (Role Mismatch)', async () => {
    // Register target in role 1 (Tank)
    await registerUserForRole(partyAId, targetMemberId, 1, guildId);

    const msg = createMockMessage({
      content: `@Raid Master -5 <@${targetMemberId}>`,
      authorId: hostUserId,
      targetUser: { id: targetMemberId },
    });

    await handleMessageCreate(msg);

    const reply = msg.getRepliedContent();
    expect(reply).toContain('ROLE MISMATCH');
    expect(reply).toContain('registered as TANK, not DPS STALKER');

    // Registration in role 1 must remain intact
    const reg = await prisma.partyRegistration.findUnique({
      where: { partyId_userId: { partyId: partyAId, userId: targetMemberId } },
      include: { role: true },
    });
    expect(reg?.role.roleNumber).toBe(1);
  });

  // 4. Host tries to assign someone to a full role
  it('4. Host tries to assign someone to a full role: rejects move and preserves current registration', async () => {
    // Fill up role 2 (capacity = 1 in DEFAULT_ALBION_ROLES)
    const fillerUser = 'filler-player-1';
    await registerUserForRole(partyAId, fillerUser, 2, guildId);

    // Target member is registered in role 1 (Tank)
    await registerUserForRole(partyAId, targetMemberId, 1, guildId);

    // Host attempts to move target member to full role 2
    const msg = createMockMessage({
      content: `@Raid Master +2 <@${targetMemberId}>`,
      authorId: hostUserId,
      targetUser: { id: targetMemberId },
    });

    await handleMessageCreate(msg);

    const reply = msg.getRepliedContent();
    expect(reply).toContain('ROLE FULL');
    expect(reply).toContain('remains registered as **Tank**');

    // Verify target member is STILL in role 1
    const reg = await prisma.partyRegistration.findUnique({
      where: { partyId_userId: { partyId: partyAId, userId: targetMemberId } },
      include: { role: true },
    });
    expect(reg?.role.roleNumber).toBe(1);
  });

  // 5. Normal member tries organizer commands
  it('5. Normal member tries organizer commands: rejected with PERMISSION DENIED', async () => {
    const msg = createMockMessage({
      content: `@Raid Master +2 <@${targetMemberId}>`,
      authorId: normalUserId,
      targetUser: { id: targetMemberId },
    });

    await handleMessageCreate(msg);

    const reply = msg.getRepliedContent();
    expect(reply).toContain('PERMISSION DENIED');
    expect(reply).toContain('Only the party host or an authorized organizer can manage member registrations');

    // Verify no registration created
    const reg = await prisma.partyRegistration.findUnique({
      where: { partyId_userId: { partyId: partyAId, userId: targetMemberId } },
    });
    expect(reg).toBeNull();
  });

  // 6. Host tries managing another host's party
  it('6. Host tries managing another host’s party: rejected with PERMISSION DENIED', async () => {
    // hostUserId (host of Party A) attempts to manage Party B (hosted by otherHostId)
    const msg = createMockMessage({
      content: `@Raid Master +2 <@${targetMemberId}>`,
      authorId: hostUserId,
      threadId: threadIdPartyB, // Party B's thread!
      targetUser: { id: targetMemberId },
    });

    await handleMessageCreate(msg);

    const reply = msg.getRepliedContent();
    expect(reply).toContain('PERMISSION DENIED');
    expect(reply).toContain('Only the party host or an authorized organizer can manage member registrations');

    // Party B must remain unaffected
    const regB = await prisma.partyRegistration.findUnique({
      where: { partyId_userId: { partyId: partyBId, userId: targetMemberId } },
    });
    expect(regB).toBeNull();
  });

  // 7. Organizer command without target mention
  it('7. Organizer command without target mention: rejected with TARGET REQUIRED', async () => {
    const msgRemove = createMockMessage({
      content: '@Raid Master -5',
      authorId: hostUserId,
      targetUser: null,
    });

    await handleMessageCreate(msgRemove);

    const replyRemove = msgRemove.getRepliedContent();
    expect(replyRemove).toContain('TARGET REQUIRED');
    expect(replyRemove).toContain('Please mention the member you want to remove (e.g. @Raid Master -5 @user)');

    const msgAssign = createMockMessage({
      content: '@Raid Master +2',
      authorId: hostUserId,
      targetUser: null,
    });

    await handleMessageCreate(msgAssign);

    const replyAssign = msgAssign.getRepliedContent();
    expect(replyAssign).toContain('TARGET REQUIRED');
    expect(replyAssign).toContain('Please mention the member you want to assign (e.g. @Raid Master +2 @user)');
  });

  // 8. Concurrent organizer and member registration
  it('8. Concurrent organizer assign and member self-registration serialize safely', async () => {
    const userA = 'concurrent-user-a';
    const userB = 'concurrent-user-b';

    // Role 1 (Tank) has capacity 1 in default roles
    // Concurrently trigger organizer assign for userA and member self-registration for userB
    const results = await Promise.allSettled([
      organizerAssignRole({
        partyId: partyAId,
        organizerId: hostUserId,
        targetUserId: userA,
        roleNumber: 1,
        guildId,
      }),
      registerUserForRole(partyAId, userB, 1, guildId),
    ]);

    const successful = results.filter((r) => r.status === 'fulfilled' && (r.value as any).success);
    const failed = results.filter(
      (r) =>
        r.status === 'rejected' ||
        (r.status === 'fulfilled' && !(r.value as any).success && (r.value as any).errorReason === 'ROLE_FULL')
    );

    // Exactly 1 must succeed and 1 must fail with ROLE_FULL
    expect(successful).toHaveLength(1);
    expect(failed).toHaveLength(1);

    // Database must strictly have 1 registration for role 1
    const role1 = await prisma.partyRole.findUnique({
      where: { partyId_roleNumber: { partyId: partyAId, roleNumber: 1 } },
      include: { registrations: true },
    });
    expect(role1?.registrations).toHaveLength(1);
  });
});
