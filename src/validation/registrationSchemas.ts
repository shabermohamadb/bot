export interface ParsedRegistrationMessage {
  isTargetedAtBot: boolean;
  isUnregister: boolean;
  roleNumber?: number;
  rawToken?: string;
  error?: string;
}

export interface ParseMessageOptions {
  botUserId: string;
  botAlias?: string;
  prefix?: string;
}

/**
 * Parses a chat message to see if it is a registration command targeting the bot.
 * Returns information on whether the message was intended for the bot,
 * whether it's an unregister request ('-'), or a role number registration.
 */
export function parseRegistrationMessage(
  content: string,
  options: ParseMessageOptions
): ParsedRegistrationMessage {
  const trimmed = content.trim();
  if (!trimmed) {
    return { isTargetedAtBot: false, isUnregister: false };
  }

  const { botUserId, botAlias, prefix } = options;

  // Patterns for mentioning the bot:
  // <@botUserId> or <@!botUserId>
  const mentionRegex = new RegExp(`^<@!?${botUserId}>`, 'i');
  // Configured alias e.g. "@Raid master" or "Raid master"
  const aliasRegex = botAlias
    ? new RegExp(`^@?${escapeRegex(botAlias)}`, 'i')
    : null;
  // Prefix e.g. "!raid" or "!"
  const prefixRegex = prefix ? new RegExp(`^${escapeRegex(prefix)}`, 'i') : null;

  let remaining = '';
  let isTargeted = false;

  if (mentionRegex.test(trimmed)) {
    isTargeted = true;
    remaining = trimmed.replace(mentionRegex, '').trim();
  } else if (aliasRegex && aliasRegex.test(trimmed)) {
    isTargeted = true;
    remaining = trimmed.replace(aliasRegex, '').trim();
  } else if (prefixRegex && prefixRegex.test(trimmed)) {
    // If prefix matches, check if immediately followed by number or '-'
    const afterPrefix = trimmed.replace(prefixRegex, '').trim();
    if (/^(\d+|-)/.test(afterPrefix)) {
      isTargeted = true;
      remaining = afterPrefix;
    }
  }

  if (!isTargeted) {
    // Message is normal chat, ignore it
    return { isTargetedAtBot: false, isUnregister: false };
  }

  // If there's nothing after the bot mention
  if (!remaining) {
    return {
      isTargetedAtBot: true,
      isUnregister: false,
      error: 'Please specify a role number to register (e.g. `@Raid master 1`) or `-` to unregister.',
    };
  }

  // Token could be '-' or a role number (or invalid token)
  const tokens = remaining.split(/\s+/);
  const firstToken = tokens[0];

  if (firstToken === '-' || firstToken === 'unregister' || firstToken === 'remove') {
    return {
      isTargetedAtBot: true,
      isUnregister: true,
      rawToken: firstToken,
    };
  }

  // Check if token is a number
  if (/^\d+$/.test(firstToken)) {
    const roleNum = parseInt(firstToken, 10);
    if (roleNum <= 0) {
      return {
        isTargetedAtBot: true,
        isUnregister: false,
        rawToken: firstToken,
        error: 'Role number must be greater than 0.',
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
    error: `Invalid registration token "${firstToken}". Send a role number (e.g. \`1\`) or \`-\` to unregister.`,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

