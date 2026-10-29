import { prisma } from '../database/client';
import { logger } from '../utils/logger';

export interface AuditLogEntry {
  guildId: string;
  partyId?: string | null;
  actorId: string;
  action: string;
  previousValue?: string | null;
  newValue?: string | null;
}

export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        guildId: entry.guildId,
        partyId: entry.partyId ?? null,
        actorId: entry.actorId,
        action: entry.action,
        previousValue: entry.previousValue ?? null,
        newValue: entry.newValue ?? null,
      },
    });

    logger.debug(
      {
        guildId: entry.guildId,
        partyId: entry.partyId,
        actorId: entry.actorId,
        action: entry.action,
      },
      `Audit log: ${entry.action}`
    );
  } catch (error) {
    logger.error({ error, entry }, 'Failed to record audit log entry');
  }
}
