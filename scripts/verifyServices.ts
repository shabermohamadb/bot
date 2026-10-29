import { prisma } from '../src/database/client';
import { getRealtimeServer, partyLiveQuery, sealPartyLiveQuery } from '../src/services/realtimeService';
import { logger } from '../src/utils/logger';

async function main() {
  console.log('========================================================');
  console.log('🧪 VERIFYING NEON SERVICES (POSTGRES + REALTIME)');
  console.log('========================================================\n');

  // -----------------------------------------------------------------
  // 1. TEST NEON LAKEBASE POSTGRES
  // -----------------------------------------------------------------
  console.log('--- 1. Testing Neon Lakebase Postgres (Prisma) ---');
  await prisma.$connect();
  console.log('✅ Connected to Neon Postgres database successfully.');

  const testPartyId = `test-verify-${Date.now()}`;
  console.log(`Inserting test party record (${testPartyId})...`);
  const created = await prisma.party.create({
    data: {
      id: testPartyId,
      guildId: 'test-guild-verification',
      organizerId: 'test-organizer',
      announcementChannelId: 'test-channel',
      ipRequirement: 1600,
      activityType: 'AVA',
      foodCount: 3,
      foodRequirementScope: 'Per Player',
      durationMinutes: 120,
      minimumTrackingToolkit: 5,
      sideTracking: 'Enabled',
      title: 'Neon Verification Raid',
      status: 'OPEN',
    },
  });
  console.log(`✅ Record inserted in Neon Postgres: ID=${created.id}, Title="${created.title}"`);

  const fetched = await prisma.party.findUnique({
    where: { id: testPartyId },
  });
  if (!fetched || fetched.id !== testPartyId) {
    throw new Error('Failed to fetch the created party from Neon Postgres!');
  }
  console.log(`✅ Record successfully queried from Neon Postgres.`);

  await prisma.party.delete({
    where: { id: testPartyId },
  });
  console.log(`✅ Test record deleted from Neon Postgres.`);
  console.log('🎉 Neon Postgres test PASSED.\n');

  // -----------------------------------------------------------------
  // 2. TEST NEON REALTIME
  // -----------------------------------------------------------------
  console.log('--- 2. Testing Neon Realtime ---');
  console.log('Sealing live query with NEON_REALTIME_SECRET...');
  const sealed = await sealPartyLiveQuery();
  console.log(`✅ Live query sealed successfully:`);
  console.log(`   - queryFingerprint: ${sealed.queryFingerprint}`);
  console.log(`   - expiresAt: ${new Date(sealed.expiresAt).toISOString()}`);
  console.log(`   - capability length: ${sealed.capability.length} chars`);

  console.log('Connecting to Neon Realtime WebSocket at NEON_REALTIME_URL...');
  const server = getRealtimeServer();
  if (!server) {
    throw new Error('Realtime server could not be instantiated!');
  }

  const query = partyLiveQuery();
  const subscription = await server.subscribe(query);
  console.log('✅ Subscribed to live party query via WebSocket.');

  const receivedInitialSnapshot = await new Promise<boolean>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for Neon Realtime initial snapshot (10s)'));
    }, 10000);

    subscription.onChange((snapshot: any) => {
      console.log(`✅ Neon Realtime update received: status="${snapshot.status}", rows=${snapshot.data?.length ?? 0}`);
      if (snapshot.status === 'live' || snapshot.data !== undefined) {
        clearTimeout(timeout);
        resolve(true);
      }
    });

    subscription.onStateChange((state: any) => {
      console.log(`📡 Neon Realtime state: ${state.status}`);
      if (state.status === 'error') {
        clearTimeout(timeout);
        reject(new Error(`Realtime subscription error: ${state.error?.message}`));
      }
    });
  });

  if (receivedInitialSnapshot) {
    console.log('🎉 Neon Realtime WebSocket live sync PASSED.\n');
  }

  subscription.unsubscribe();
  await server.close();
  await prisma.$disconnect();

  console.log('========================================================');
  console.log('✅ ALL NEON SERVICES VERIFIED END-TO-END SUCCESSFULLY!');
  console.log('========================================================');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});

