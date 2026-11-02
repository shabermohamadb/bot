export interface ParsedRegistrationMessage {
  isTargetedAtBot: boolean;
  isUnregister: boolean;
  roleNumber?: number;
  rawToken?: string;
  error?: string;

  // Organizer powers
  isOrganizerCommand?: boolean;
  organizerAction?: 'ASSIGN' | 'REMOVE';
  targetUserId?: string;
  missingTarget?: boolean;
}

export interface ParseMessageOptions {
  botUserId: string;
  botAlias?: string | string[];
  prefix?: string;
  isReplyToBot?: boolean;
}

/**
 * Parses a chat message to see if it is a registration command targeting the bot.
 * Supports:
 * - Method 1: Bot Mention Registration (@Party Raid 1..5)
 * - Method 2: Reply-Based Registration (Reply with 1..5)
 * - Organizer Powers: @Raid Master +<role> @user and @Raid Master -<role> @user
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
    if (/^([+-]?\d+|-)/.test(afterPrefix)) {
      isTargeted = true;
      remaining = afterPrefix;
    }
  }

  // METHOD 2: Reply-Based Registration & Organizer Commands in replies
  if (!isTargeted && isReplyToBot) {
    // Check if reply is an organizer command (e.g. +2 @user or -5 @user)
    if (/^[+-]\s*#?\d+/i.test(trimmed)) {
      isTargeted = true;
      remaining = trimmed;
    } else {
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

  // CHECK FOR ORGANIZER COMMANDS: +<roleNumber> [@user] or -<roleNumber> [@user]
  const organizerMatch = remaining.match(/^([+-])\s*#?(\d+)(.*)$/i);
  if (organizerMatch) {
    const sign = organizerMatch[1];
    const roleNum = parseInt(organizerMatch[2], 10);
    const rest = organizerMatch[3].trim();

    // Check for target user mention or raw user ID in rest
    const userMentionMatch = rest.match(/<@!?(\d+)>/) || rest.match(/\b(\d{17,20})\b/);
    const targetUserId = userMentionMatch ? userMentionMatch[1] : undefined;
    const missingTarget = !targetUserId;

    if (roleNum < 1 || roleNum > 5) {
      return {
        isTargetedAtBot: true,
        isUnregister: false,
        isOrganizerCommand: true,
        organizerAction: sign === '+' ? 'ASSIGN' : 'REMOVE',
        roleNumber: roleNum,
        targetUserId,
        missingTarget,
        error: 'Role number must be between 1 and 5. Check the role list in this thread.',
      };
    }

    return {
      isTargetedAtBot: true,
      isUnregister: false,
      isOrganizerCommand: true,
      organizerAction: sign === '+' ? 'ASSIGN' : 'REMOVE',
      roleNumber: roleNum,
      targetUserId,
      missingTarget,
      rawToken: `${sign}${roleNum}`,
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

