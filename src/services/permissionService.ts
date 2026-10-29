import { GuildMember, PermissionFlagsBits } from 'discord.js';
import { prisma } from '../database/client';

export interface PartyPermissionContext {
  partyId?: string;
  organizerId?: string;
  guildId: string;
  userId: string;
  member?: GuildMember | null;
}

/**
 * Checks whether a user has administrative or organizer permissions for a party or guild.
 */
export async function isOrganizerOrAdmin(context: PartyPermissionContext): Promise<boolean> {
  const { partyId, organizerId, guildId, userId, member } = context;

  // 1. If user is the direct organizer of the party
  if (organizerId && organizerId === userId) {
    return true;
  }

  // If partyId was passed instead of organizerId, fetch from DB
  if (partyId && !organizerId) {
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { organizerId: true },
    });
    if (party && party.organizerId === userId) {
      return true;
    }
  }

  // 2. If Discord member object is available, check server permissions
  if (member) {
    // Server owner always has full permissions
    if (member.guild.ownerId === userId) {
      return true;
    }

    // Server Administrator or ManageGuild permissions
    if (
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.permissions.has(PermissionFlagsBits.ManageGuild)
    ) {
      return true;
    }

    // 3. Check for configured Organizer role in GuildConfig
    const config = await prisma.guildConfig.findUnique({
      where: { guildId },
      select: { organizerRoleId: true },
    });

    if (config?.organizerRoleId && member.roles.cache.has(config.organizerRoleId)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a user is allowed to remove or edit another member's registration.
 * Regular users can only modify their own registration; organizers can override anyone.
 */
export async function canManageRegistration(
  context: PartyPermissionContext,
  targetUserId: string
): Promise<{ allowed: boolean; reason?: string }> {
  // If user is operating on their own registration
  if (context.userId === targetUserId) {
    return { allowed: true };
  }

  // Otherwise, user must be an authorized organizer/admin
  const isAuthorized = await isOrganizerOrAdmin(context);
  if (isAuthorized) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: 'You do not have permission to modify another member’s registration.',
  };
}
