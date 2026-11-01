import { prisma } from '../database/client';
import { logAuditEvent } from './auditService';
import { PartyWithRelations } from './embedService';
import { getPartyById, updateThreadPartyCache } from './partyService';
import { publishDashboardEvent } from './dashboardEventBus';
import { logger } from '../utils/logger';

export interface RegistrationResult {
  success: boolean;
  message: string;
  party: PartyWithRelations;
  action: 'REGISTERED' | 'ROLE_SWITCHED' | 'ALREADY_REGISTERED' | 'UNREGISTERED' | 'REJECTED';
  errorReason?: 'ROLE_FULL' | 'PARTY_NOT_OPEN' | 'INVALID_ROLE' | 'NOT_REGISTERED' | 'INTERNAL_ERROR';
  roleNumber?: number;
  roleName?: string;
  previousRoleNumber?: number;
  previousRoleName?: string;
}

export class RoleFullError extends Error {
  public roleName: string;
  constructor(message: string, roleName: string = '') {
    super(message);
    this.name = 'RoleFullError';
    this.roleName = roleName;
  }
}

/**
 * Registers a user for a role by number, or switches their role if already registered.
 * Enforces strict one-user-one-role rule per party atomically inside a single high-efficiency database transaction.
 */
export async function registerUserForRole(
  partyId: string,
  userId: string,
  roleNumber: number,
  guildId: string,
  cachedParty?: PartyWithRelations | null
): Promise<RegistrationResult> {
  // 1. Fetch current party state (use cached if provided)
  const party = cachedParty || (await getPartyById(partyId));
  if (!party) {
    return {
      success: false,
      message: 'Party not found.',
      party: null as any,
      action: 'REJECTED',
      errorReason: 'INTERNAL_ERROR',
    };
  }

  // 2. Reject if party is not OPEN
  if (party.status !== 'OPEN') {
    return {
      success: false,
      message: `Cannot register: this party is currently **${party.status.toLowerCase()}**.`,
      party,
      action: 'REJECTED',
      errorReason: 'PARTY_NOT_OPEN',
    };
  }

  // 3. Find the requested role definition
  const targetRole = party.roles.find((r) => r.roleNumber === roleNumber);
  if (!targetRole) {
    const availableRoles = party.roles
      .sort((a, b) => a.roleNumber - b.roleNumber)
      .map((r) => `\`${r.roleNumber}\` (${r.roleName})`)
      .join(', ');

    return {
      success: false,
      message: `Invalid role number **${roleNumber}**. Available roles are: ${availableRoles}`,
      party,
      action: 'REJECTED',
      errorReason: 'INVALID_ROLE',
    };
  }

  // Execute database transaction for atomic check, unique registration enforcement & capacity verification
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Row-level lock on the target role to guarantee serialization under concurrent requests
      try {
        await tx.$queryRaw`SELECT id FROM "PartyRole" WHERE id = ${targetRole.id} FOR UPDATE`;
      } catch {
        // Safe fallback in environments without FOR UPDATE support
      }

      // Parallel fetch: live target role capacity with registrations count, and user's existing registration
      const [liveTargetRole, liveRegistration] = await Promise.all([
        tx.partyRole.findUnique({
          where: {
            partyId_roleNumber: {
              partyId,
              roleNumber,
            },
          },
          include: {
            registrations: true,
          },
        }),
        tx.partyRegistration.findUnique({
          where: {
            partyId_userId: {
              partyId,
              userId,
            },
          },
          include: {
            role: true,
          },
        }),
      ]);

      if (!liveTargetRole) {
        throw new Error('Target role not found');
      }

      // 4. If user is ALREADY registered for the exact same role, return immediately (0 mutations)
      if (liveRegistration && liveRegistration.roleId === liveTargetRole.id) {
        return {
          action: 'ALREADY_REGISTERED' as const,
          roleNumber: liveTargetRole.roleNumber,
          roleName: liveTargetRole.roleName,
          previousRoleNumber: undefined,
          previousRoleName: undefined,
          updatedParty: party,
        };
      }

      const currentCount = liveTargetRole.registrations.length;

      // 5. Check if target role is at capacity
      if (currentCount >= liveTargetRole.capacity) {
        const currentRole = liveRegistration?.role;
        const currentRoleName = currentRole ? currentRole.roleName : 'your current role';
        throw new RoleFullError(
          `Role **${liveTargetRole.roleNumber} (${liveTargetRole.roleName})** is already full (${currentCount}/${liveTargetRole.capacity}).` +
            (liveRegistration ? ` You remain registered as **${currentRoleName}**.` : ''),
          liveTargetRole.roleName
        );
      }

      let action: 'REGISTERED' | 'ROLE_SWITCHED';
      let previousRoleNumber: number | undefined;
      let previousRoleName: string | undefined;

      // 6. Atomic role switch or new registration
      if (liveRegistration) {
        action = 'ROLE_SWITCHED';
        previousRoleNumber = liveRegistration.role?.roleNumber;
        previousRoleName = liveRegistration.role?.roleName;

        await tx.partyRegistration.update({
          where: { id: liveRegistration.id },
          data: {
            roleId: liveTargetRole.id,
          },
        });
      } else {
        action = 'REGISTERED';
        await tx.partyRegistration.create({
          data: {
            partyId,
            roleId: liveTargetRole.id,
            userId,
          },
        });
      }

      // 7. Fetch updated party snapshot inside the transaction (atomic state)
      const updatedParty = await tx.party.findUnique({
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

      return {
        action,
        roleNumber: liveTargetRole.roleNumber,
        roleName: liveTargetRole.roleName,
        previousRoleNumber,
        previousRoleName,
        updatedParty: updatedParty!,
      };
    }, { maxWait: 10000, timeout: 20000 });

    const updatedParty = result.updatedParty;

    // Asynchronous non-blocking audit logging
    if (result.action !== 'ALREADY_REGISTERED') {
      logAuditEvent({
        guildId,
        partyId,
        actorId: userId,
        action: result.action,
        previousValue: result.previousRoleName ? `Role ${result.previousRoleNumber} (${result.previousRoleName})` : null,
        newValue: `Role ${result.roleNumber} (${result.roleName})`,
      }).catch((err) => logger.warn({ err }, 'Non-blocking registration audit log failed'));

      // Update thread-to-party cache
      if (updatedParty?.threadId) {
        updateThreadPartyCache(updatedParty.threadId, updatedParty);
      }
    }

    if (result.action === 'ALREADY_REGISTERED') {
      return {
        success: true,
        message: `You are already registered as ${targetRole.roleName}.`,
        party: updatedParty,
        action: 'ALREADY_REGISTERED',
        roleNumber: targetRole.roleNumber,
        roleName: targetRole.roleName,
      };
    } else if (result.action === 'ROLE_SWITCHED') {
      logger.info({ partyId, userId, roleNumber }, 'User switched party role');

      publishDashboardEvent('registration:switched', partyId, {
        userId,
        roleNumber: targetRole.roleNumber,
        roleName: targetRole.roleName,
        previousRoleNumber: result.previousRoleNumber,
        previousRoleName: result.previousRoleName,
      });

      return {
        success: true,
        message: `Switched from **${result.previousRoleName}** to **Role ${targetRole.roleNumber} (${targetRole.roleName})**!`,
        party: updatedParty,
        action: 'ROLE_SWITCHED',
        roleNumber: targetRole.roleNumber,
        roleName: targetRole.roleName,
        previousRoleNumber: result.previousRoleNumber,
        previousRoleName: result.previousRoleName,
      };
    } else {
      logger.info({ partyId, userId, roleNumber }, 'User registered for party role');

      publishDashboardEvent('registration:created', partyId, {
        userId,
        roleNumber: targetRole.roleNumber,
        roleName: targetRole.roleName,
      });

      return {
        success: true,
        message: `Registered for **Role ${targetRole.roleNumber} (${targetRole.roleName})**!`,
        party: updatedParty,
        action: 'REGISTERED',
        roleNumber: targetRole.roleNumber,
        roleName: targetRole.roleName,
      };
    }
  } catch (error: any) {
    if (error instanceof RoleFullError) {
      return {
        success: false,
        message: error.message,
        party: (await getPartyById(partyId)) || party,
        action: 'REJECTED',
        errorReason: 'ROLE_FULL',
        roleNumber: targetRole.roleNumber,
        roleName: error.roleName || targetRole.roleName,
      };
    }

    // Handle concurrent duplicate registration race condition gracefully
    if (error?.code === 'P2002') {
      const refreshedParty = (await getPartyById(partyId)) || party;
      const userReg = refreshedParty.registrations?.find((r) => r.userId === userId);
      const userRole = refreshedParty.roles.find((r) => r.id === userReg?.roleId);
      return {
        success: true,
        message: `You are already registered as ${userRole?.roleName || 'a role'}.`,
        party: refreshedParty,
        action: 'ALREADY_REGISTERED',
        roleNumber: userRole?.roleNumber,
        roleName: userRole?.roleName,
      };
    }

    logger.error({ error, partyId, userId, roleNumber }, 'Failed to register user for role');
    throw error;
  }
}

/**
 * Unregisters a user from their active role in the party.
 * Atomically verifies and removes only the caller's registration from that party.
 */
export async function unregisterUser(
  partyId: string,
  userId: string,
  guildId: string,
  actorId: string = userId,
  cachedParty?: PartyWithRelations | null
): Promise<RegistrationResult> {
  const party = cachedParty || (await getPartyById(partyId));
  if (!party) {
    return {
      success: false,
      message: 'Party not found.',
      party: null as any,
      action: 'REJECTED',
      errorReason: 'INTERNAL_ERROR',
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Find the user's specific registration inside this party
      const existing = await tx.partyRegistration.findUnique({
        where: {
          partyId_userId: {
            partyId,
            userId,
          },
        },
        include: {
          role: true,
        },
      });

      if (!existing) {
        return null;
      }

      await tx.partyRegistration.delete({
        where: { id: existing.id },
      });

      // Snapshot updated party directly inside the transaction
      const updatedParty = await tx.party.findUnique({
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

      return {
        removedRole: existing.role,
        updatedParty: updatedParty!,
      };
    }, { maxWait: 10000, timeout: 20000 });

    if (!result) {
      return {
        success: false,
        message: actorId === userId
          ? 'You do not have an active registration in this party.'
          : `<@${userId}> does not have an active registration in this party.`,
        party,
        action: 'REJECTED',
        errorReason: 'NOT_REGISTERED',
      };
    }

    const { removedRole, updatedParty } = result;

    // Asynchronous non-blocking audit logging
    logAuditEvent({
      guildId,
      partyId,
      actorId,
      action: actorId === userId ? 'UNREGISTERED' : 'OVERRIDE_REMOVED',
      previousValue: removedRole ? `Role ${removedRole.roleNumber} (${removedRole.roleName})` : null,
    }).catch((err) => logger.warn({ err }, 'Non-blocking unregister audit log failed'));

    // Update thread cache
    if (updatedParty.threadId) {
      updateThreadPartyCache(updatedParty.threadId, updatedParty);
    }

    logger.info({ partyId, userId, actorId }, 'User unregistered from party');

    publishDashboardEvent('registration:removed', partyId, {
      userId,
      roleNumber: removedRole.roleNumber,
      roleName: removedRole.roleName,
      actorId,
    });

    return {
      success: true,
      message: actorId === userId
        ? `You have unregistered from **${removedRole.roleName}**.`
        : `Removed <@${userId}> from **${removedRole.roleName}**.`,
      party: updatedParty,
      action: 'UNREGISTERED',
      roleNumber: removedRole.roleNumber,
      roleName: removedRole.roleName,
    };
  } catch (error) {
    logger.error({ error, partyId, userId }, 'Error in unregisterUser transaction');
    throw error;
  }
}
