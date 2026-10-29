const { prisma } = require('../dist/database/client');

async function cleanTestArtifacts() {
  console.log('--- Cleaning Confirmed Test Artifacts ---');

  const testGuildIds = ['guild-one-user-rule', 'guild-reg-test', 'guild-perf-test', 'test-guild-verification'];

  const testParties = await prisma.party.findMany({
    where: { guildId: { in: testGuildIds } },
  });

  console.log(`Found ${testParties.length} test parties to remove.`);
  for (const p of testParties) {
    console.log(`- Deleting test party ${p.id} (guild: ${p.guildId}, organizer: ${p.organizerId})`);
    await prisma.partyRegistration.deleteMany({ where: { partyId: p.id } });
    await prisma.partyRole.deleteMany({ where: { partyId: p.id } });
    await prisma.auditLog.deleteMany({ where: { partyId: p.id } });
    await prisma.party.delete({ where: { id: p.id } });
  }

  // Also remove test audit logs not tied to a party if any
  const leftoverAuditLogs = await prisma.auditLog.deleteMany({
    where: { guildId: { in: testGuildIds } },
  });
  if (leftoverAuditLogs.count > 0) {
    console.log(`Removed ${leftoverAuditLogs.count} leftover test audit logs.`);
  }

  const remainingParties = await prisma.party.count();
  const remainingRegistrations = await prisma.partyRegistration.count();
  const remainingAuditLogs = await prisma.auditLog.count();

  console.log('\n--- Current Database State ---');
  console.log(`Genuine Parties: ${remainingParties}`);
  console.log(`Genuine Registrations: ${remainingRegistrations}`);
  console.log(`Genuine Audit Logs: ${remainingAuditLogs}`);

  await prisma.$disconnect();
}

cleanTestArtifacts().catch(console.error);

