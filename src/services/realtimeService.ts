import { createRealtime, rawSql, type RealtimeDirectServer } from '@neon/realtime/server';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface LivePartyRow {
  id: string;
  guildId: string;
  status: string;
  ipRequirement: number;
  activityType: string;
  title: string | null;
}

let realtimeServer: RealtimeDirectServer<unknown> | null = null;
let activeSubscription: any = null;

/**
 * Returns the Neon Realtime server instance configured with the app's credentials.
 */
export function getRealtimeServer(): RealtimeDirectServer<unknown> | null {
  if (realtimeServer) return realtimeServer;

  const url = env.NEON_REALTIME_URL;
  const secret = env.NEON_REALTIME_SECRET;

  if (!url || !secret) {
    logger.warn('NEON_REALTIME_URL or NEON_REALTIME_SECRET is not configured. Neon Realtime will be inactive.');
    return null;
  }

  let dbName = 'neondb';
  try {
    const parsedUrl = new URL(env.DATABASE_URL);
    dbName = parsedUrl.pathname.replace(/^\//, '') || 'neondb';
  } catch {
    // fallback to neondb
  }

  realtimeServer = createRealtime({
    url,
    secret,
    db: dbName,
    debugMode: env.NODE_ENV !== 'production',
  });

  return realtimeServer;
}

/**
 * Live SQL query for active parties in Lakebase Postgres.
 */
export function partyLiveQuery() {
  return rawSql<LivePartyRow>(
    `SELECT id, "guildId", status, "ipRequirement", "activityType", title FROM "Party" ORDER BY "createdAt" DESC LIMIT 50`
  );
}

/**
 * Initializes the Neon Realtime live query subscriber.
 * Automatically receives live database updates over WebSockets whenever parties change.
 */
export async function initRealtimeSubscriber(): Promise<void> {
  const server = getRealtimeServer();
  if (!server) return;

  try {
    logger.info('Initializing Neon Realtime subscriber for Party updates...');
    const query = partyLiveQuery();
    activeSubscription = await server.subscribe(query);

    activeSubscription.onChange((snapshot: any) => {
      logger.info(
        {
          status: snapshot.status,
          rowCount: snapshot.data?.length ?? 0,
        },
        'Neon Realtime: Received live update for parties'
      );
    });

    activeSubscription.onStateChange((state: any) => {
      logger.info({ status: state.status, error: state.error?.message }, 'Neon Realtime state changed');
    });

    logger.info('Neon Realtime subscription established successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize Neon Realtime subscriber');
  }
}

/**
 * Seals the party live query for client or external consumption.
 */
export async function sealPartyLiveQuery() {
  const server = getRealtimeServer();
  if (!server) {
    throw new Error('Neon Realtime is not configured');
  }
  const query = partyLiveQuery();
  return server.seal({ query });
}

/**
 * Gracefully shuts down Neon Realtime subscriptions.
 */
export async function closeRealtime(): Promise<void> {
  try {
    if (activeSubscription) {
      activeSubscription.unsubscribe();
      activeSubscription = null;
    }
    if (realtimeServer) {
      realtimeServer.close();
      realtimeServer = null;
    }
    logger.info('Neon Realtime closed gracefully');
  } catch (error) {
    logger.error({ error }, 'Error closing Neon Realtime');
  }
}
