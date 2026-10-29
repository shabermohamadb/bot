import { z } from 'zod';

export const ActivityTypeEnum = z.enum(['AVA', 'Outlands', 'Both']);
export type ActivityType = z.infer<typeof ActivityTypeEnum>;

export const FoodRequirementScopeEnum = z.enum(['Per Player', 'Per Party']);
export type FoodRequirementScope = z.infer<typeof FoodRequirementScopeEnum>;

export const SideTrackingEnum = z.enum(['Enabled', 'Disabled', 'Not Specified']);
export type SideTracking = z.infer<typeof SideTrackingEnum>;

export const PartyStatusEnum = z.enum(['OPEN', 'CLOSED', 'CANCELLED']);
export type PartyStatus = z.infer<typeof PartyStatusEnum>;

export const PartyRoleInputSchema = z.object({
  roleNumber: z.number().int().min(1, 'Role number must be at least 1').max(50, 'Role number cannot exceed 50'),
  roleName: z.string().trim().min(1, 'Role name cannot be empty').max(50, 'Role name cannot exceed 50 characters'),
  capacity: z.number().int().min(1, 'Role capacity must be at least 1').max(50, 'Role capacity cannot exceed 50'),
});
export type PartyRoleInput = z.infer<typeof PartyRoleInputSchema>;

export const CreatePartySchema = z.object({
  guildId: z.string().min(1, 'Guild ID is required'),
  organizerId: z.string().min(1, 'Organizer ID is required'),
  announcementChannelId: z.string().min(1, 'Announcement channel ID is required'),
  title: z.string().trim().max(100, 'Title cannot exceed 100 characters').optional().nullable(),
  header: z.string().trim().max(250, 'Header cannot exceed 250 characters').optional().nullable(),
  footer: z.string().trim().max(250, 'Footer cannot exceed 250 characters').optional().nullable(),
  threadName: z.string().trim().min(1, 'Thread name is required').max(100, 'Thread name cannot exceed 100 characters'),
  ipRequirement: z.number().int().min(0, 'IP requirement must be non-negative').max(3000, 'IP requirement cannot exceed 3000'),
  activityType: ActivityTypeEnum,
  foodCount: z.number().int().min(0, 'Food count must be non-negative').max(100, 'Food count cannot exceed 100'),
  foodRequirementScope: FoodRequirementScopeEnum.default('Per Player'),
  durationMinutes: z.number().int().min(1, 'Duration must be at least 1 minute').max(1440, 'Duration cannot exceed 24 hours (1440 mins)'),
  minimumTrackingToolkit: z.number().int().min(0, 'Tracking toolkit must be non-negative').max(500, 'Tracking toolkit cannot exceed 500'),
  sideTracking: SideTrackingEnum.default('Not Specified'),
  roles: z.array(PartyRoleInputSchema).min(1, 'Party must have at least one role')
    .refine((roles) => {
      const numbers = roles.map((r) => r.roleNumber);
      return new Set(numbers).size === numbers.length;
    }, 'Role numbers must be unique within the party'),
});
export type CreatePartyInput = z.infer<typeof CreatePartySchema>;

export const EditPartySchema = z.object({
  title: z.string().trim().max(100).optional().nullable(),
  header: z.string().trim().max(250).optional().nullable(),
  footer: z.string().trim().max(250).optional().nullable(),
  ipRequirement: z.number().int().min(0).max(3000).optional(),
  activityType: ActivityTypeEnum.optional(),
  foodCount: z.number().int().min(0).max(100).optional(),
  foodRequirementScope: FoodRequirementScopeEnum.optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  minimumTrackingToolkit: z.number().int().min(0).max(500).optional(),
  sideTracking: SideTrackingEnum.optional(),
  roles: z.array(PartyRoleInputSchema).min(1).optional()
    .refine((roles) => {
      if (!roles) return true;
      const numbers = roles.map((r) => r.roleNumber);
      return new Set(numbers).size === numbers.length;
    }, 'Role numbers must be unique within the party'),
});
export type EditPartyInput = z.infer<typeof EditPartySchema>;

/**
 * Standard default roles for Albion Online AVA runs
 */
export const DEFAULT_ALBION_ROLES: PartyRoleInput[] = [
  { roleNumber: 1, roleName: 'Tank', capacity: 1 },
  { roleNumber: 2, roleName: 'Heal', capacity: 1 },
  { roleNumber: 3, roleName: 'DPS Cultist', capacity: 2 },
  { roleNumber: 4, roleName: 'DPS Mana', capacity: 1 },
  { roleNumber: 5, roleName: 'DPS Stalker', capacity: 1 },
];

/**
 * Parses duration from strings like "2 hours", "90m", "1.5h", "120 minutes", or raw numbers.
 */
export function parseDurationString(input: string | number): number {
  if (typeof input === 'number') {
    if (isNaN(input) || input <= 0) throw new Error('Duration must be a positive number');
    return Math.round(input);
  }

  const str = input.trim().toLowerCase();
  if (/^\d+$/.test(str)) {
    const val = parseInt(str, 10);
    if (val <= 0) throw new Error('Duration must be a positive number of minutes');
    return val;
  }

  const hoursMatch = str.match(/^([\d.]+)\s*(h|hr|hrs|hour|hours)$/);
  if (hoursMatch) {
    const hours = parseFloat(hoursMatch[1]);
    if (isNaN(hours) || hours <= 0) throw new Error('Invalid duration hours');
    return Math.round(hours * 60);
  }

  const minsMatch = str.match(/^(\d+)\s*(m|min|mins|minute|minutes)$/);
  if (minsMatch) {
    const mins = parseInt(minsMatch[1], 10);
    if (isNaN(mins) || mins <= 0) throw new Error('Invalid duration minutes');
    return mins;
  }

  throw new Error(`Invalid duration format "${input}". Use format like "2 hours", "90 mins", or "120".`);
}

/**
 * Parses roles from formatted strings like:
 * "1: Tank (1), 2: Heal (1), 3: DPS (2)" or "1 - Tank: 1 / 2 - Heal: 1"
 */
export function parseRolesString(input: string): PartyRoleInput[] {
  const items = input.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) {
    throw new Error('No roles provided in input string');
  }

  const roles: PartyRoleInput[] = [];

  for (const item of items) {
    // Matches: "1: Tank (2)", "1. Tank (2)", "1 - Tank [2]", "1: Tank 2", "1 Tank 2"
    const match = item.match(/^(\d+)[\s.:\-]+(.+?)(?:[\s(\[:\-]+(\d+)[)\]]*)?$/);
    if (!match) {
      throw new Error(`Could not parse role string: "${item}". Format should be "Number: Name (Capacity)", e.g. "1: Tank (1)"`);
    }

    const roleNumber = parseInt(match[1], 10);
    const roleName = match[2].trim();
    const capacity = match[3] ? parseInt(match[3], 10) : 1;

    if (isNaN(roleNumber) || roleNumber < 1) {
      throw new Error(`Invalid role number in "${item}"`);
    }
    if (!roleName) {
      throw new Error(`Invalid role name in "${item}"`);
    }
    if (isNaN(capacity) || capacity < 1) {
      throw new Error(`Invalid capacity for role "${roleName}". Must be at least 1.`);
    }

    roles.push({ roleNumber, roleName, capacity });
  }

  // Check unique role numbers
  const seenNumbers = new Set<number>();
  for (const role of roles) {
    if (seenNumbers.has(role.roleNumber)) {
      throw new Error(`Duplicate role number ${role.roleNumber} found.`);
    }
    seenNumbers.add(role.roleNumber);
  }

  return roles;
}
