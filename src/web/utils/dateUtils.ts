import { env } from '../../config/env';

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
  year: number;
}

export interface WeekRange extends DateRange {
  weekNumber: number;
  offset: number;
}

export interface MonthRange extends DateRange {
  month: number; // 1-12
  monthName: string;
  offset: number;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Returns the configured server timezone.
 */
export function getServerTimezone(): string {
  return env.SERVER_TIMEZONE || 'UTC';
}

/**
 * Calculates ISO 8601 week number (Monday as first day of week).
 */
export function getISOWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Computes a Monday-to-Sunday week range for a given offset from current week.
 * offset: 0 = current week, -1 = last week, +1 = next week.
 */
export function getWeekRange(offset: number = 0, referenceDate: Date = new Date()): WeekRange {
  const ref = new Date(referenceDate);
  // Get current day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  const day = ref.getUTCDay();
  // In Monday-Sunday week, Monday is 1, Sunday is 7
  const diffToMonday = (day === 0 ? -6 : 1) - day;

  const monday = new Date(ref);
  monday.setUTCDate(ref.getUTCDate() + diffToMonday + (offset * 7));
  monday.setUTCHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  const startMonth = MONTH_NAMES[monday.getUTCMonth()].slice(0, 3);
  const endMonth = MONTH_NAMES[sunday.getUTCMonth()].slice(0, 3);
  const startDay = monday.getUTCDate();
  const endDay = sunday.getUTCDate();
  const year = sunday.getUTCFullYear();

  let label: string;
  if (startMonth === endMonth) {
    label = `${startMonth} ${startDay} — ${endDay}, ${year}`;
  } else {
    label = `${startMonth} ${startDay} — ${endMonth} ${endDay}, ${year}`;
  }

  return {
    start: monday,
    end: sunday,
    label,
    year,
    weekNumber: getISOWeekNumber(monday),
    offset,
  };
}

/**
 * Computes a calendar month range for a given offset from current month.
 * offset: 0 = current month, -1 = last month, +1 = next month.
 */
export function getMonthRange(offset: number = 0, referenceDate: Date = new Date()): MonthRange {
  const ref = new Date(referenceDate);
  let year = ref.getUTCFullYear();
  let month = ref.getUTCMonth() + offset;

  // Handle year roll-over
  while (month < 0) {
    month += 12;
    year -= 1;
  }
  while (month > 11) {
    month -= 12;
    year += 1;
  }

  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  // Day 0 of next month is the last day of the target month
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

  const monthName = MONTH_NAMES[month];
  const label = `${monthName} ${year}`;

  return {
    start,
    end,
    label,
    year,
    month: month + 1,
    monthName,
    offset,
  };
}

/**
 * Computes an All-Time range starting from epoch to current time.
 */
export function getAllTimeRange(): DateRange {
  return {
    start: new Date(0),
    end: new Date(),
    label: 'All Time',
    year: new Date().getUTCFullYear(),
  };
}

/**
 * Formats a date into a clean ISO date string (YYYY-MM-DD).
 */
export function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}

/**
 * Formats a date into a user-friendly format e.g. "Oct 29, 2026, 18:30 UTC".
 */
export function formatFullDateTime(d: Date): string {
  const month = MONTH_NAMES[d.getUTCMonth()].slice(0, 3);
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${month} ${day}, ${year} ${hours}:${minutes} UTC`;
}

