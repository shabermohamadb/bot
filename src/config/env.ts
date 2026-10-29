import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

// If DATABASE_PATH is provided instead of / in addition to DATABASE_URL, set DATABASE_URL
if (process.env.DATABASE_PATH && !process.env.DATABASE_URL) {
  const resolvedPath = path.resolve(process.env.DATABASE_PATH);
  // Ensure the directory exists
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  process.env.DATABASE_URL = `file:${resolvedPath}`;
} else if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:./dev.db';
}

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  DISCORD_GUILD_ID: z.string().optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_URL_UNPOOLED: z.string().optional(),
  DATABASE_PATH: z.string().optional(),
  NEON_BRANCH: z.string().optional(),
  NEON_REALTIME_URL: z.string().optional(),
  NEON_REALTIME_SECRET: z.string().optional(),
  BOT_PREFIX: z.string().default('!'),
  BOT_NAME_ALIAS: z.string().default('Raid master'),
  BOT_ALIAS_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (typeof val === 'boolean') return val;
      if (typeof val === 'string') return val.trim().toLowerCase() === 'true';
      return false;
    }),
  ORGANIZER_ROLE_IDS: z.string().optional().default(''),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  SERVER_TIMEZONE: z.string().default('UTC'),
  APP_BASE_URL: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_REDIRECT_URI: z.string().optional(),
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
