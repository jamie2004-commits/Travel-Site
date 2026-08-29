import type { City, ItineraryItem } from '../types';
import type { Catalog } from './catalog';
import { addMinutes, formatDuration } from './format';

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
  /** End of the last timed item, if its length is known. */
  to?: string;
  /** Time actually spent inside items, ignoring the gaps between them. */
  busyMinutes: number;
  /** Items with no start time yet. */
  untimed: number;
}

/** The shape of a day at a glance: when it starts, when it ends, how full. */
export function dayWindow(items: ItineraryItem[]): DayWindow {
  let from: number | undefined;
  let to: number | undefined;
  let busy = 0;
  let untimed = 0;
  for (const item of items) {
    busy += item.durationMinutes ?? 0;
    const start = toMinutes(item.startTime);
    if (start === undefined) {
      untimed += 1;
      continue;
    }
    const end = start + (item.durationMinutes ?? 0);
    if (from === undefined || start < from) from = start;
    if (to === undefined || end > to) to = end;
  }
  const fmt = (v: number) =>
    `${String(Math.floor((v % 1440) / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  return {
    from: from === undefined ? undefined : fmt(from),
    to: to === undefined ? undefined : fmt(to),
    busyMinutes: busy,
    untimed,
  };
}

/** "09:00 to 18:30 · 6h 30m inside stops", or nothing when the day is untimed. */
export function describeWindow(window: DayWindow): string {
  const parts: string[] = [];
  if (window.from) parts.push(window.to ? `${window.from}–${window.to}` : `from ${window.from}`);
  const busy = formatDuration(window.busyMinutes);
  if (busy) parts.push(busy);
  return parts.join(' · ');
}

/**
 * Item indexes whose start time lands before the item above them has finished.
 * Reading order is the plan, so an out of sequence time is what we flag, not a
 * reason to reorder behind the user's back.
 */
export function clashes(items: ItineraryItem[]): Set<number> {
  const out = new Set<number>();
  let previousEnd: number | undefined;
  items.forEach((item, i) => {
    const start = toMinutes(item.startTime);
    if (start === undefined) return;
    if (previousEnd !== undefined && start < previousEnd) out.add(i);
    previousEnd = start + (item.durationMinutes ?? 0);
  });
  return out;
}

/**
 * Start times for every item in order, running from `start` and leaving `gap`
 * minutes between one item and the next. Items with no length still take their
 * turn, so nothing silently overlaps.
 */
export function autoTimes(
  items: ItineraryItem[],
  start: string,
  gap: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  let cursor = start;
  items.forEach((item, i) => {
    out[item.id] = cursor;
    cursor = addMinutes(cursor, (item.durationMinutes ?? 0) + (i === items.length - 1 ? 0 : gap));
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
