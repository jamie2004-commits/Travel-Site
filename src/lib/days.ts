import type { Day } from '../types';
import { arrivesNextDay } from './travel';

/**
 * Whether the trip opens on a departure eve — a night that is only the journey
 * out, where you set off on one date and the trip proper starts when you land
 * on the next. Numbering that night "Day 1" makes every real day of the trip
 * read one too high, so it becomes Day 0 and the landing day becomes Day 1.
 *
 * Two things count as a departure eve, because people write them both ways:
 * a first day with nothing on it but the journey, or one carrying a leg that
 * is still in the air at midnight.
 */
export function startsAtZero(days: Day[]): boolean {
  const first = days[0];
  if (!first?.items.length) return false;
  const legs = first.items.filter((item) => item.travel);
  if (!legs.length) return false;
  if (legs.length === first.items.length) return true;
  return legs.some((item) => arrivesNextDay(item.startTime, item.travel?.arrive));
}

/** Add this to a day's index to get the number to print against it. */
export function dayNumberOffset(days: Day[]): 0 | 1 {
  return startsAtZero(days) ? 0 : 1;
}

/** The highest day number in the trip, for "Day 3 of 7". */
export function lastDayNumber(days: Day[]): number {
  return days.length - 1 + dayNumberOffset(days);
}
