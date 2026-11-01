export interface ParsedRegistrationMessage {
  isTargetedAtBot: boolean;
  isUnregister: boolean;
  roleNumber?: number;
  rawToken?: string;
  error?: string;
}

export interface ParseMessageOptions {
  botUserId: string;
  botAlias?: string | string[];
  prefix?: string;
  isReplyToBot?: boolean;
}

/**
 * Parses a chat message to see if it is a registration command targeting the bot.
 * Supports both Method 1 (Bot Mention Registration) and Method 2 (Reply-Based Registration).
 * Returns information on whether the message was intended for the bot,
 * whether it's an unregister request ('-'), or a role number registration (1-5).
 */
export function parseRegistrationMessage(
  content: string,
  options: ParseMessageOptions
): ParsedRegistrationMessage {
  const trimmed = content.trim();
  if (!trimmed) {
    return { isTargetedAtBot: false, isUnregister: false };
  }

  const { botUserId, botAlias, prefix, isReplyToBot } = options;

  // Patterns for mentioning the bot:
  // <@botUserId> or <@!botUserId>
  const mentionRegex = new RegExp(`^<@!?${botUserId}>`, 'i');

  // Configured aliases e.g. "@Party Raid", "Party Raid", "@Raid master"
  const aliases = Array.isArray(botAlias) ? botAlias : botAlias ? [botAlias] : [];

  // Prefix e.g. "!raid" or "!"
  const prefixRegex = prefix ? new RegExp(`^${escapeRegex(prefix)}`, 'i') : null;

  let remaining = '';
  let isTargeted = false;

  // METHOD 1: Bot Mention Registration
  if (mentionRegex.test(trimmed)) {
    isTargeted = true;
    remaining = trimmed.replace(mentionRegex, '').trim();
  } else {
    for (const a of aliases) {
      if (!a) continue;
      const aliasRegex = new RegExp(`^@?${escapeRegex(a)}`, 'i');
      if (aliasRegex.test(trimmed)) {
        isTargeted = true;
        remaining = trimmed.replace(aliasRegex, '').trim();
        break;
      }
    }
  }

  if (!isTargeted && prefixRegex && prefixRegex.test(trimmed)) {
    const afterPrefix = trimmed.replace(prefixRegex, '').trim();
    if (/^(\d+|-)/.test(afterPrefix)) {
      isTargeted = true;
      remaining = afterPrefix;
    }
  }

  // METHOD 2: Reply-Based Registration
  // If the user replied directly to a bot message in a party thread
  if (!isTargeted && isReplyToBot) {
    const singleNumberMatch = trimmed.match(/^(?:role\s*|r(?=\d)\s*)?#?(\d+)[.!]?$/i);
    if (singleNumberMatch) {
      const roleNum = parseInt(singleNumberMatch[1], 10);
      if (roleNum >= 1 && roleNum <= 5) {
        isTargeted = true;
        remaining = String(roleNum);
      } else if (roleNum === 0 || (roleNum > 5 && roleNum <= 9)) {
        // Single digit out of 1-5 range: recognize as attempted role selection and validate
        return {
          isTargetedAtBot: true,
          isUnregister: false,
          rawToken: trimmed,
          error: 'Role number must be between 1 and 5. Check the role list in this thread.',
        };
      }
      // If > 9 (e.g. 1500 for IP, 20 for duration), ignore as unrelated conversation
    } else if (/^(\-|unregister|remove|cancel|leave)$/i.test(trimmed)) {
      isTargeted = true;
      remaining = '-';
    }
  }

  if (!isTargeted) {
    // Message is normal chat or unrelated reply, ignore it with zero database overhead
    return { isTargetedAtBot: false, isUnregister: false };
  }

  // If there's nothing after the bot mention
  if (!remaining) {
    return {
      isTargetedAtBot: true,
      isUnregister: false,
      error: 'Please specify a role number (1-5) to register (e.g. `@Party Raid 1` or reply with `1`) or `-` to unregister.',
    };
  }

  // Normalize remaining string by removing optional "role " or "r<digit>" prefix
  remaining = remaining.replace(/^(?:role\s*|r(?=\d)\s*)/i, '').trim();

  // Token could be '-' or a role number (or invalid token)
  const tokens = remaining.split(/\s+/);
  const firstToken = tokens[0].replace(/^#/, '').replace(/[.!]?$/, '');

  if (firstToken === '-' || firstToken.toLowerCase() === 'unregister' || firstToken.toLowerCase() === 'remove' || firstToken.toLowerCase() === 'cancel' || firstToken.toLowerCase() === 'leave') {
    return {
      isTargetedAtBot: true,
      isUnregister: true,
      rawToken: firstToken,
    };
  }

  // Check if token is a number
  if (/^\d+$/.test(firstToken)) {
    const roleNum = parseInt(firstToken, 10);
    if (roleNum < 1 || roleNum > 5) {
      return {
        isTargetedAtBot: true,
        isUnregister: false,
        rawToken: firstToken,
        error: 'Role number must be between 1 and 5. Check the role list in this thread.',
      };
    }
    return {
      isTargetedAtBot: true,
      isUnregister: false,
      roleNumber: roleNum,
      rawToken: firstToken,
    };
  }

  // User mentioned bot with an invalid token
  return {
    isTargetedAtBot: true,
    isUnregister: false,
    rawToken: firstToken,
    error: `Invalid registration token "${firstToken}". Send a role number (1 to 5) or \`-\` to unregister.`,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

