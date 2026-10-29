import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { logger } from './logger';

export function isDiscordAPIError(error: unknown): error is DiscordAPIError {
  return error instanceof DiscordAPIError;
}

export function handleDiscordAPIError(error: unknown, context: string): { message: string; code?: number } {
  if (isDiscordAPIError(error)) {
    logger.warn({ code: error.code, status: error.status, context }, `Discord API error in ${context}: ${error.message}`);

    switch (error.code) {
      case RESTJSONErrorCodes.UnknownMessage:
        return { message: 'The party message could not be found (it may have been deleted).', code: error.code as number };
      case RESTJSONErrorCodes.UnknownChannel:
        return { message: 'The channel or thread could not be found.', code: error.code as number };
      case RESTJSONErrorCodes.MissingPermissions:
      case RESTJSONErrorCodes.MissingAccess:
        return { message: 'The bot lacks required permissions in that channel or thread.', code: error.code as number };
      case RESTJSONErrorCodes.ThreadLocked:
        return { message: 'The thread is locked and cannot be updated.', code: error.code as number };
      case RESTJSONErrorCodes.MaximumActiveThreads:
        return { message: 'Maximum active threads reached for this guild.', code: error.code as number };
      default:
        return { message: `Discord error: ${error.message}`, code: error.code as number };
    }
  }

  logger.error({ error, context }, `Unexpected error in ${context}`);
  return { message: 'An unexpected error occurred. Please contact an administrator.' };
}
