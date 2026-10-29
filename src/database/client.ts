import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma =
  global.prisma ||
  new PrismaClient({
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

// Bind log events to structured logger
(prisma as any).$on?.('error', (e: any) => {
  logger.error({ err: e }, 'Prisma error');
});
(prisma as any).$on?.('warn', (e: any) => {
  logger.warn({ warning: e }, 'Prisma warning');
});

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

export async function connectDatabase(maxRetries = 5, retryDelayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$connect();
      logger.info('Connected to database successfully');
      return;
    } catch (error) {
      if (attempt === maxRetries) {
        logger.error({ error, attempt }, 'Failed to connect to database after maximum retries');
        throw error;
      }
      logger.warn({ attempt, maxRetries }, `Database connection attempt ${attempt} failed, retrying in ${retryDelayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info('Disconnected from database');
  } catch (error) {
    logger.error({ error }, 'Error disconnecting from database');
  }
}

