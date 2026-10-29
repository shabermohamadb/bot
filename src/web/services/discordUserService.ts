import { Client } from 'discord.js';
import { logger } from '../../utils/logger';

export interface DiscordUserProfile {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

// In-memory cache with 1-hour TTL
interface CachedUser {
  profile: DiscordUserProfile;
  cachedAt: number;
}

const userCache = new Map<string, CachedUser>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let discordClientRef: Client | null = null;

export function setDiscordClientForWeb(client: Client): void {
  discordClientRef = client;
}

export function getDefaultAvatarUrl(userId: string): string {
  try {
    const idBig = BigInt(userId || '0');
    const index = Number(idBig % 5n);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  } catch {
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }
}

/**
 * Resolves a Discord user's username, display name, and avatar URL.
 * Checks local cache first, then fetches via discord.js client if available.
 * Falls back to clean placeholder if Discord API is unreachable.
 */
export async function resolveDiscordUser(userId: string): Promise<DiscordUserProfile> {
  if (!userId) {
    return {
      userId: 'unknown',
      username: 'Unknown Host',
      displayName: 'Unknown Host',
      avatarUrl: getDefaultAvatarUrl('0'),
    };
  }

  // 1. Check Cache
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.profile;
  }

  // Fallback profile: genuine user ID only, never fabricate fake names like "Host-XXXX"
  const fallbackProfile: DiscordUserProfile = {
    userId,
    username: userId,
    displayName: userId,
    avatarUrl: getDefaultAvatarUrl(userId),
  };

  // 2. Fetch from Discord if client is available
  if (discordClientRef && discordClientRef.isReady()) {
    try {
      const user = await discordClientRef.users.fetch(userId);
      if (user) {
        const avatarUrl = user.displayAvatarURL({ size: 128, extension: 'png' }) || getDefaultAvatarUrl(userId);
        const profile: DiscordUserProfile = {
          userId: user.id,
          username: user.username,
          displayName: user.displayName || user.username,
          avatarUrl,
        };
        userCache.set(userId, { profile, cachedAt: Date.now() });
        return profile;
      }
    } catch (err: any) {
      logger.debug({ userId, err: err.message }, 'Could not fetch user from Discord API, using fallback profile');
    }
  }

  userCache.set(userId, { profile: fallbackProfile, cachedAt: Date.now() });
  return fallbackProfile;
}

/**
 * Resolves multiple Discord users in parallel with caching.
 */
export async function resolveDiscordUsers(userIds: string[]): Promise<Map<string, DiscordUserProfile>> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  const profiles = await Promise.all(uniqueIds.map((id) => resolveDiscordUser(id)));
  const map = new Map<string, DiscordUserProfile>();
  profiles.forEach((p) => map.set(p.userId, p));
  return map;
}

