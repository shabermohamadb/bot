const { prisma } = require('../dist/database/client');

async function inspect() {
  const parties = await prisma.party.findMany({
    include: {
      roles: {
        include: {
          registrations: true,
        },
      },
    },
  });

  console.log('TOTAL PARTIES IN DB:', parties.length);
  for (const p of parties) {
    console.log(
      JSON.stringify({
        id: p.id,
        title: p.title,
        organizerId: p.organizerId,
        guildId: p.guildId,
        status: p.status,
        activityType: p.activityType,
        createdAt: p.createdAt,
        registrationsCount: p.roles.reduce((acc, r) => acc + r.registrations.length, 0),
        users: p.roles.flatMap((r) => r.registrations.map((reg) => reg.userId)),
      })
    );
  }

  const auditLogs = await prisma.auditLog.findMany();
  console.log('AUDIT LOGS:');
  for (const a of auditLogs) {
    console.log(JSON.stringify(a));
  }
  await prisma.$disconnect();
}

inspect().catch(console.error);
