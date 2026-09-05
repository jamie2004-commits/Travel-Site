import { get, set } from 'idb-keyval';
import type { Catalog } from './catalog';
import type { Itinerary } from '../types';

/**
 * The trips this browser knows how to open.
 *
 * Deliberately a list held here rather than a query against the server, and the
 * reason is worth stating because "just list them" is the obvious design.
 *
 * Listing trips from the database means a policy that lets anyone read every
 * row's label, and from there its code, and from there the trip. A trip holds
 * flight numbers, seat numbers, hotel phone numbers and booking references, so
 * a public list of them is a public list of those. Knowing a code is the
 * permission, and a list of codes is a list of permissions: it belongs to the
 * browser that has been given them, not to the server.
 *
 * So: this browser's own trip goes in automatically, a trip opened by code is
 * added the moment it opens, and a machine that has never seen a trip needs the
 * code once. After that it is in the list and never needs typing again.
 */

const KEY = 'itinerary-builder/known-trips/v1';

export interface KnownTrip {
  code: string;
  /** "Shanghai and Hangzhou, September 2026". For recognising, never for finding. */
  label: string;
  /** ISO. Newest first in the list, because that is the one you want. */
  lastOpened: string;
  /** True for the trip this browser created, as opposed to one it was given. */
  mine?: boolean;
}

export async function readKnownTrips(): Promise<KnownTrip[]> {
  try {
    const stored = await get<KnownTrip[]>(KEY);
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((t) => t && typeof t.code === 'string')
      .sort((a, b) => (b.lastOpened ?? '').localeCompare(a.lastOpened ?? ''));
  } catch {
    return [];
  }
}

/** Add one, or refresh what is known about it. Keyed on the code. */
export async function rememberTrip(trip: Omit<KnownTrip, 'lastOpened'>): Promise<void> {
  try {
    const all = await readKnownTrips();
    const rest = all.filter((t) => t.code !== trip.code);
    const next: KnownTrip[] = [
      { ...trip, lastOpened: new Date().toISOString() },
      ...rest,
    ].slice(0, 20);
    await set(KEY, next);
  } catch (cause) {
    console.warn('Could not remember this trip.', cause);
  }
}

export async function forgetTrip(code: string): Promise<void> {
  try {
    const all = await readKnownTrips();
    await set(
      KEY,
      all.filter((t) => t.code !== code),
    );
  } catch {
    // Nothing to do. The trip itself is unaffected either way.
  }
}

/**
 * "Shanghai and Hangzhou, September 2026".
 *
 * Cities first because that is what tells two trips apart at a glance, then the
 * month, because a trip is one span of days and the exact date is noise in a
 * list. A span across two months says both.
 *
 * The catalog is what turns a stop's place id into a city, so this reads better
 * with one and still works without: an unresolvable trip falls back to its own
 * name, which is what the user typed at the top of the sheet.
 */
export function describeTrip(itinerary: Itinerary, catalog?: Catalog): string {
  const cities = new Set<string>();
  if (catalog) {
    for (const day of itinerary.days ?? []) {
      for (const item of day.items ?? []) {
        const place = item.placeId ? catalog.placeById[item.placeId] : undefined;
        if (place) cities.add(CITY_NAMES[place.city] ?? place.city);
      }
    }
  }

  const dates = (itinerary.days ?? [])
    .map((d) => d.date)
    .filter((d): d is string => Boolean(d))
    .sort();

  const where = cities.size ? [...cities].join(' and ') : itinerary.name?.trim() || 'Trip';
  const when = dates.length ? monthSpan(dates[0], dates[dates.length - 1]) : '';
  return when ? `${where}, ${when}` : where;
}

const CITY_NAMES: Record<string, string> = { shanghai: 'Shanghai', hangzhou: 'Hangzhou' };

/** "September 2026", or "September to October 2026" when it runs across one. */
function monthSpan(first: string, last: string): string {
  const a = new Date(`${first}T00:00:00`);
  const b = new Date(`${last}T00:00:00`);
  if (Number.isNaN(a.getTime())) return '';
  const month = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long' });
  const year = (d: Date) => d.getFullYear();
  if (Number.isNaN(b.getTime()) || (month(a) === month(b) && year(a) === year(b))) {
    return `${month(a)} ${year(a)}`;
  }
  if (year(a) === year(b)) return `${month(a)} to ${month(b)} ${year(b)}`;
  return `${month(a)} ${year(a)} to ${month(b)} ${year(b)}`;
}
