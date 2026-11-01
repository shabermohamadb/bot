import { prisma } from '../../src/database/client';

/**
 * Clears database records created during unit and integration test runs.
 * Scoped strictly to test guilds to guarantee real Discord parties are never deleted.
 */
export async function clearDatabase(): Promise<void> {
  const testParties = await prisma.party.findMany({
    where: {
      OR: [
        { guildId: { startsWith: 'guild-' } },
        { guildId: { startsWith: 'test-' } },
      ],
    },
    select: { id: true },
  });

  const testPartyIds = testParties.map((p) => p.id);
  if (testPartyIds.length > 0) {
    await prisma.partyRegistration.deleteMany({
      where: { partyId: { in: testPartyIds } },
    });
    await prisma.partyRole.deleteMany({
      where: { partyId: { in: testPartyIds } },
    });
    await prisma.auditLog.deleteMany({
      where: { partyId: { in: testPartyIds } },
    });
    await prisma.party.deleteMany({
      where: { id: { in: testPartyIds } },
    });
  }
}
