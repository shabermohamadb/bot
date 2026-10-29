import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  DISCORD_GUILD_ID: z.string().optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required').default('file:./dev.db'),
  BOT_PREFIX: z.string().default('!'),
  BOT_NAME_ALIAS: z.string().default('Raid master'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // If we are in test mode and some discord variables are missing, provide defaults
  if (process.env.NODE_ENV === 'test') {
    process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'mock_test_token';
    process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || 'mock_test_client_id';
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:./dev.db';
  } else {
    console.error('❌ Invalid environment variables:', parsed.error.format());
    throw new Error('Invalid environment variables');
  }
}

export const env = parsed.success ? parsed.data : envSchema.parse(process.env);
