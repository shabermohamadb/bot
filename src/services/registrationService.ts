import { prisma } from '../database/client';
import { logAuditEvent } from './auditService';
import { PartyWithRelations } from './embedService';
import { getPartyById } from './partyService';
import { logger } from '../utils/logger';

export interface RegistrationResult {
  success: boolean;
  message: string;
  party: PartyWithRelations;
  action: 'REGISTERED' | 'ROLE_SWITCHED' | 'UNREGISTERED' | 'REJECTED';
  roleNumber?: number;
  roleName?: string;
  previousRoleNumber?: number;
  previousRoleName?: string;
}

/**
 * Registers a user for a role by number, or switches their role if already registered.
 * Executed atomically in a database transaction with capacity verification.
 */
export async function registerUserForRole(
  partyId: string,
  userId: string,
  roleNumber: number,
  guildId: string
): Promise<RegistrationResult> {
  // 1. Fetch current party state
  const party = await getPartyById(partyId);
  if (!party) {
    return {
      success: false,
      message: 'Party not found.',
      party: null as any,
      action: 'REJECTED',
    };
  }

  // 2. Reject if party is not OPEN
  if (party.status !== 'OPEN') {
    return {
      success: false,
      message: `Cannot register: this party is currently **${party.status.toLowerCase()}**.`,
      party,
      action: 'REJECTED',
    };
  }

  // 3. Find the requested role
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
    };
  }

  // 4. Check existing registration of this user
  const existingRegistration = party.registrations?.find((r) => r.userId === userId);

  // If already in this role
  if (existingRegistration && existingRegistration.roleId === targetRole.id) {
    return {
      success: true,
      message: `You are already registered for **Role ${targetRole.roleNumber} (${targetRole.roleName})**.`,
      party,
      action: 'REGISTERED',
      roleNumber: targetRole.roleNumber,
      roleName: targetRole.roleName,
    };
  }

  // Execute database transaction for atomic check & update
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-fetch roles with live registration counts inside transaction
      const liveRoles = await tx.partyRole.findMany({
        where: { partyId },
        include: {
          registrations: true,
        },
      });

      const liveTargetRole = liveRoles.find((r) => r.id === targetRole.id);
      if (!liveTargetRole) {
        throw new Error('Target role not found');
      }

      const currentCount = liveTargetRole.registrations.length;

      // Check if target role is at capacity
      if (currentCount >= liveTargetRole.capacity) {
        if (existingRegistration) {
          const currentRole = liveRoles.find((r) => r.id === existingRegistration.roleId);
          const currentRoleName = currentRole ? currentRole.roleName : 'your current role';
          throw new RoleFullError(
            `Role **${liveTargetRole.roleNumber} (${liveTargetRole.roleName})** is already full (${currentCount}/${liveTargetRole.capacity}). You remain registered as **${currentRoleName}**.`
          );
        } else {
          throw new RoleFullError(
            `Role **${liveTargetRole.roleNumber} (${liveTargetRole.roleName})** is already full (${currentCount}/${liveTargetRole.capacity}).`
          );
        }
      }

      // If user is switching roles
      if (existingRegistration) {
        const previousRole = liveRoles.find((r) => r.id === existingRegistration.roleId);

        await tx.partyRegistration.update({
          where: { id: existingRegistration.id },
          data: {
            roleId: liveTargetRole.id,
          },
        });

        await tx.auditLog.create({
          data: {
            guildId,
            partyId,
            actorId: userId,
            action: 'ROLE_SWITCHED',
            previousValue: previousRole ? `Role ${previousRole.roleNumber} (${previousRole.roleName})` : null,
            newValue: `Role ${liveTargetRole.roleNumber} (${liveTargetRole.roleName})`,
          },
        });

        return {
          action: 'ROLE_SWITCHED' as const,
          previousRoleNumber: previousRole?.roleNumber,
          previousRoleName: previousRole?.roleName,
        };
      } else {
        // New registration
        await tx.partyRegistration.create({
          data: {
            partyId,
            roleId: liveTargetRole.id,
            userId,
          },
        });

        await tx.auditLog.create({
          data: {
            guildId,
            partyId,
            actorId: userId,
            action: 'REGISTERED',
            newValue: `Role ${liveTargetRole.roleNumber} (${liveTargetRole.roleName})`,
          },
        });

        return {
          action: 'REGISTERED' as const,
        };
      }
    });

    // Fetch updated authoritative party state
    const updatedParty = (await getPartyById(partyId))!;

    if (result.action === 'ROLE_SWITCHED') {
      logger.info({ partyId, userId, roleNumber }, 'User switched party role');
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
      };
    }

    logger.error({ error, partyId, userId, roleNumber }, 'Error during registration transaction');
    throw error;
  }
}

/**
 * Removes a user's active registration from a party.
 */
export async function unregisterUser(
  partyId: string,
  userId: string,
  guildId: string,
  actorId: string = userId
): Promise<RegistrationResult> {
  const party = await getPartyById(partyId);
  if (!party) {
    return {
      success: false,
      message: 'Party not found.',
      party: null as any,
      action: 'REJECTED',
    };
  }

  // Check if target user has an active registration
  const existing = party.registrations?.find((r) => r.userId === userId);
  if (!existing) {
    return {
      success: false,
      message: actorId === userId
        ? 'You do not have an active registration in this party.'
        : `<@${userId}> does not have an active registration in this party.`,
      party,
      action: 'REJECTED',
    };
  }

  const role = party.roles.find((r) => r.id === existing.roleId);

  await prisma.$transaction(async (tx) => {
    await tx.partyRegistration.delete({
      where: { id: existing.id },
    });

    await tx.auditLog.create({
      data: {
        guildId,
        partyId,
        actorId,
        action: actorId === userId ? 'UNREGISTERED' : 'OVERRIDE_REMOVED',
        previousValue: role ? `Role ${role.roleNumber} (${role.roleName})` : null,
      },
    });
  });

  const updatedParty = (await getPartyById(partyId))!;
  logger.info({ partyId, userId, actorId }, 'User unregistered from party');

  return {
    success: true,
    message: actorId === userId
      ? `You have unregistered from **${role?.roleName || 'your role'}**.`
      : `Removed <@${userId}> from **${role?.roleName || 'their role'}**.`,
    party: updatedParty,
    action: 'UNREGISTERED',
    roleNumber: role?.roleNumber,
    roleName: role?.roleName,
  };
}

class RoleFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleFullError';
  }
}
