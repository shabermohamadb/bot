import { prisma } from '../database/client';
import { CreatePartyInput, EditPartyInput } from '../validation/partySchemas';
import { PartyWithRelations } from './embedService';
import { logAuditEvent } from './auditService';
import { publishDashboardEvent } from './dashboardEventBus';
import { logger } from '../utils/logger';

export async function createParty(input: CreatePartyInput): Promise<PartyWithRelations> {
  const result = await prisma.$transaction(async (tx) => {
    const party = await tx.party.create({
      data: {
        guildId: input.guildId,
        organizerId: input.organizerId,
        announcementChannelId: input.announcementChannelId,
        title: input.title,
        header: input.header,
        footer: input.footer,
        ipRequirement: input.ipRequirement,
        activityType: input.activityType,
        foodCount: input.foodCount,
        foodRequirementScope: input.foodRequirementScope,
        durationMinutes: input.durationMinutes,
        minimumTrackingToolkit: input.minimumTrackingToolkit,
        sideTracking: input.sideTracking,
        status: 'OPEN',
        roles: {
          create: input.roles.map((r) => ({
            roleNumber: r.roleNumber,
            roleName: r.roleName,
            capacity: r.capacity,
          })),
        },
      },
      include: {
        roles: {
          include: {
            registrations: true,
          },
        },
        registrations: true,
      },
    });

    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        partyId: party.id,
        actorId: input.organizerId,
        action: 'PARTY_CREATED',
        newValue: JSON.stringify({
          title: party.title,
          activity: party.activityType,
          ipRequirement: party.ipRequirement,
          rolesCount: party.roles.length,
        }),
      },
    });

    return party;
  }, { maxWait: 10000, timeout: 20000 });

  logger.info({ partyId: result.id, guildId: result.guildId }, 'Created new party in database');

  // Publish event to dashboard clients after database commit
  publishDashboardEvent('party:created', result.id, {
    title: result.title,
    organizerId: result.organizerId,
    status: result.status,
    activityType: result.activityType,
    ipRequirement: result.ipRequirement,
  });

  return result;
}

export async function updatePartyDiscordIds(
  partyId: string,
  announcementMessageId: string,
  threadId: string
): Promise<PartyWithRelations> {
  const party = await prisma.party.update({
    where: { id: partyId },
    data: {
      announcementMessageId,
      threadId,
    },
    include: {
      roles: {
        include: {
          registrations: true,
        },
      },
      registrations: true,
    },
  });

  return party;
}

export async function getPartyById(partyId: string): Promise<PartyWithRelations | null> {
  return prisma.party.findUnique({
    where: { id: partyId },
    include: {
      roles: {
        include: {
          registrations: true,
        },
      },
      registrations: true,
    },
  });
}

interface CachedThreadParty {
  party: PartyWithRelations;
  cachedAt: number;
}

const threadPartyCache = new Map<string, CachedThreadParty>();
const THREAD_CACHE_TTL_MS = 15_000; // 15 seconds TTL

export function invalidateThreadPartyCache(threadId?: string): void {
  if (threadId) {
    threadPartyCache.delete(threadId);
  } else {
    threadPartyCache.clear();
  }
}

export function updateThreadPartyCache(threadId: string, party: PartyWithRelations): void {
  threadPartyCache.set(threadId, {
    party,
    cachedAt: Date.now(),
  });
}

export async function getPartyByThreadId(
  threadId: string,
  referencedMessageId?: string,
  skipCache: boolean = false
): Promise<PartyWithRelations | null> {
  const cacheKey = `${threadId}:${referencedMessageId || ''}`;
  if (!skipCache) {
    const cached = threadPartyCache.get(cacheKey) || threadPartyCache.get(threadId);
    if (cached && Date.now() - cached.cachedAt < THREAD_CACHE_TTL_MS) {
      return cached.party;
    }
  }

  const orConditions: any[] = [
    { threadId },
    { announcementMessageId: threadId },
  ];
  if (referencedMessageId) {
    orConditions.push({ announcementMessageId: referencedMessageId });
    orConditions.push({ threadId: referencedMessageId });
  }

  // 1. Prefer OPEN party matching threadId or announcementMessageId
  let party = await prisma.party.findFirst({
    where: {
      status: 'OPEN',
      OR: orConditions,
    },
    include: {
      roles: {
        include: {
          registrations: true,
        },
      },
      registrations: true,
    },
  });

  // 2. If no OPEN party found, fallback to any status so callers can report specific status (e.g. CLOSED)
  if (!party) {
    party = await prisma.party.findFirst({
      where: {
        OR: orConditions,
      },
      include: {
        roles: {
          include: {
            registrations: true,
          },
        },
        registrations: true,
      },
    });
  }

  if (party) {
    threadPartyCache.set(threadId, {
      party,
      cachedAt: Date.now(),
    });
    if (referencedMessageId) {
      threadPartyCache.set(referencedMessageId, {
        party,
        cachedAt: Date.now(),
      });
    }
  }

  return party;
}

export async function getPartyByMessageId(messageId: string): Promise<PartyWithRelations | null> {
  return prisma.party.findFirst({
    where: { announcementMessageId: messageId },
    include: {
      roles: {
        include: {
          registrations: true,
        },
      },
      registrations: true,
    },
  });
}

export async function getActiveParties(guildId?: string): Promise<PartyWithRelations[]> {
  return prisma.party.findMany({
    where: {
      status: 'OPEN',
      ...(guildId ? { guildId } : {}),
    },
    include: {
      roles: {
        include: {
          registrations: true,
        },
      },
      registrations: true,
    },
  });
}

export async function editParty(
  partyId: string,
  updates: EditPartyInput,
  actorId: string,
  guildId: string
): Promise<PartyWithRelations> {
  const existing = await getPartyById(partyId);
  if (!existing) {
    throw new Error(`Party with ID "${partyId}" not found`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    // If roles are being updated
    if (updates.roles && updates.roles.length > 0) {
      // For each new role specification, update or create
      for (const roleInput of updates.roles) {
        const currentRole = existing.roles.find((r) => r.roleNumber === roleInput.roleNumber);
        if (currentRole) {
          // If capacity is reduced below current registrations count, warn or prevent
          const currentCount = currentRole.registrations.length;
          if (roleInput.capacity < currentCount) {
            throw new Error(
              `Cannot reduce capacity for Role ${roleInput.roleNumber} (${roleInput.roleName}) to ${roleInput.capacity} because ${currentCount} player(s) are already registered.`
            );
          }
          await tx.partyRole.update({
            where: { id: currentRole.id },
            data: {
              roleName: roleInput.roleName,
              capacity: roleInput.capacity,
            },
          });
        } else {
          // Create new role
          await tx.partyRole.create({
            data: {
              partyId,
              roleNumber: roleInput.roleNumber,
              roleName: roleInput.roleName,
              capacity: roleInput.capacity,
            },
          });
        }
      }
    }

    const party = await tx.party.update({
      where: { id: partyId },
      data: {
        title: updates.title !== undefined ? updates.title : undefined,
        header: updates.header !== undefined ? updates.header : undefined,
        footer: updates.footer !== undefined ? updates.footer : undefined,
        ipRequirement: updates.ipRequirement !== undefined ? updates.ipRequirement : undefined,
        activityType: updates.activityType !== undefined ? updates.activityType : undefined,
        foodCount: updates.foodCount !== undefined ? updates.foodCount : undefined,
        foodRequirementScope: updates.foodRequirementScope !== undefined ? updates.foodRequirementScope : undefined,
        durationMinutes: updates.durationMinutes !== undefined ? updates.durationMinutes : undefined,
        minimumTrackingToolkit: updates.minimumTrackingToolkit !== undefined ? updates.minimumTrackingToolkit : undefined,
        sideTracking: updates.sideTracking !== undefined ? updates.sideTracking : undefined,
      },
      include: {
        roles: {
          include: {
            registrations: true,
          },
        },
        registrations: true,
      },
    });

    await tx.auditLog.create({
      data: {
        guildId,
        partyId,
        actorId,
        action: 'PARTY_EDITED',
        previousValue: JSON.stringify({
          title: existing.title,
          ipRequirement: existing.ipRequirement,
          activityType: existing.activityType,
        }),
        newValue: JSON.stringify(updates),
      },
    });

    return party;
  }, { maxWait: 10000, timeout: 20000 });

  if (updated.threadId) {
    invalidateThreadPartyCache(updated.threadId);
  }

  publishDashboardEvent('party:updated', updated.id, {
    title: updated.title,
    status: updated.status,
    activityType: updated.activityType,
  });

  return updated;
}

export async function closeParty(
  partyId: string,
  actorId: string,
  guildId: string
): Promise<PartyWithRelations> {
  const existing = await getPartyById(partyId);
  if (!existing) {
    throw new Error(`Party with ID "${partyId}" not found`);
  }

  if (existing.status === 'CLOSED') {
    return existing;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const party = await tx.party.update({
      where: { id: partyId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
      },
      include: {
        roles: {
          include: {
            registrations: true,
          },
        },
        registrations: true,
      },
    });

    await tx.auditLog.create({
      data: {
        guildId,
        partyId,
        actorId,
        action: 'PARTY_CLOSED',
        previousValue: existing.status,
        newValue: 'CLOSED',
      },
    });

    return party;
  }, { maxWait: 10000, timeout: 20000 });

  if (updated.threadId) {
    invalidateThreadPartyCache(updated.threadId);
  }

  publishDashboardEvent('party:status_changed', updated.id, {
    status: 'CLOSED',
    closedAt: updated.closedAt,
  });

  logger.info({ partyId, actorId }, 'Party closed');
  return updated;
}

export async function reopenParty(
  partyId: string,
  actorId: string,
  guildId: string
): Promise<PartyWithRelations> {
  const existing = await getPartyById(partyId);
  if (!existing) {
    throw new Error(`Party with ID "${partyId}" not found`);
  }

  if (existing.status === 'OPEN') {
    return existing;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const party = await tx.party.update({
      where: { id: partyId },
      data: {
        status: 'OPEN',
        closedAt: null,
      },
      include: {
        roles: {
          include: {
            registrations: true,
          },
        },
        registrations: true,
      },
    });

    await tx.auditLog.create({
      data: {
        guildId,
        partyId,
        actorId,
        action: 'PARTY_REOPENED',
        previousValue: existing.status,
        newValue: 'OPEN',
      },
    });

    return party;
  }, { maxWait: 10000, timeout: 20000 });

  if (updated.threadId) {
    invalidateThreadPartyCache(updated.threadId);
  }

  publishDashboardEvent('party:status_changed', updated.id, {
    status: 'OPEN',
  });

  logger.info({ partyId, actorId }, 'Party reopened');
  return updated;
}

export async function cancelParty(
  partyId: string,
  actorId: string,
  guildId: string
): Promise<PartyWithRelations> {
  const existing = await getPartyById(partyId);
  if (!existing) {
    throw new Error(`Party with ID "${partyId}" not found`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const party = await tx.party.update({
      where: { id: partyId },
      data: {
        status: 'CANCELLED',
        closedAt: new Date(),
      },
      include: {
        roles: {
          include: {
            registrations: true,
          },
        },
        registrations: true,
      },
    });

    await tx.auditLog.create({
      data: {
        guildId,
        partyId,
        actorId,
        action: 'PARTY_CANCELLED',
        previousValue: existing.status,
        newValue: 'CANCELLED',
      },
    });

    return party;
  }, { maxWait: 10000, timeout: 20000 });

  if (updated.threadId) {
    invalidateThreadPartyCache(updated.threadId);
  }

  publishDashboardEvent('party:status_changed', updated.id, {
    status: 'CANCELLED',
    closedAt: updated.closedAt,
  });

  logger.info({ partyId, actorId }, 'Party cancelled');
  return updated;
}

