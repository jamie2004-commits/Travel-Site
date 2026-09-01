import type { City, ItineraryItem } from '../types';
import type { Catalog } from './catalog';
import { addMinutes } from './format';

/** Minutes past midnight, or undefined for an item with no start time. */
function toMinutes(time?: string): number | undefined {
  if (!time) return undefined;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return undefined;
  return h * 60 + m;
}

export interface DayWindow {
  /** First start time in the day, if anything is timed. */
  from?: string;
  /** Last start time in the day. The day has no end: stops only start. */
  to?: string;
  /** Items with no start time yet. */
  untimed: number;
}

/** The shape of a day at a glance: when the first stop starts and the last. */
export function dayWindow(items: ItineraryItem[]): DayWindow {
  let from: number | undefined;
  let to: number | undefined;
  let untimed = 0;
  for (const item of items) {
    const start = toMinutes(item.startTime);
    if (start === undefined) {
      untimed += 1;
      continue;
    }
    if (from === undefined || start < from) from = start;
    if (to === undefined || start > to) to = start;
  }
  const fmt = (v: number) =>
    `${String(Math.floor((v % 1440) / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  return {
    from: from === undefined ? undefined : fmt(from),
    to: to === undefined ? undefined : fmt(to),
    untimed,
  };
}

/** "09:00–18:30", "from 09:00", or nothing when the day is untimed. */
export function describeWindow(window: DayWindow): string {
  if (!window.from) return '';
  if (!window.to || window.to === window.from) return `from ${window.from}`;
  return `${window.from}–${window.to}`;
}

/**
 * Item indexes whose start time lands before the stop above them starts.
 * Reading order is the plan, so a time out of sequence is what we flag, not a
 * reason to reorder behind the user's back.
 */
export function clashes(items: ItineraryItem[]): Set<number> {
  const out = new Set<number>();
  let previousStart: number | undefined;
  items.forEach((item, i) => {
    const start = toMinutes(item.startTime);
    if (start === undefined) return;
    if (previousStart !== undefined && start < previousStart) out.add(i);
    previousStart = start;
  });
  return out;
}

/**
 * Start times for every item in order, running from `start` and leaving
 * `every` minutes between one stop and the next. Stops have no length, so an
 * even spacing is the only honest thing to lay out; nudge the odd one after.
 */
export function autoTimes(
  items: ItineraryItem[],
  start: string,
  every: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  let cursor = start;
  items.forEach((item) => {
    out[item.id] = cursor;
    cursor = addMinutes(cursor, every);
  });
  return out;
}

/** Which cities a day touches, in the order they first appear. */
export function dayCities(items: ItineraryItem[], catalog: Catalog): City[] {
  const seen: City[] = [];
  for (const item of items) {
    const place = item.placeId ? catalog.placeById[item.placeId] : undefined;
    if (place && !seen.includes(place.city)) seen.push(place.city);
  }
  return seen;
}
