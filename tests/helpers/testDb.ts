import { prisma } from '../../src/database/client';

export async function clearDatabase(): Promise<void> {
  await prisma.partyRegistration.deleteMany();
  await prisma.partyRole.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.party.deleteMany();
  await prisma.guildConfig.deleteMany();
}
