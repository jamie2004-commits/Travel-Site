import { get, set } from 'idb-keyval';
import type { Catalog } from './catalog';
import type { Itinerary } from '../types';

/**
 * The trips this browser has been given, held here rather than on the server.
 *
 * This is the half that cannot come from a query: a trip opened by its code
 * belongs to somebody else's identity, so no owner scoped select will ever
 * return it. Knowing the code is the permission, and a list of codes is a list
 * of permissions, which belongs to the browser that was given them.
 *
 * The trips this browser *owns* are a different question and do come from the
 * server, through `myTrips()`. Row level security already scopes that to
 * `auth.uid()`, so it returns your own trips and nobody else's. The distinction
 * matters: "list every trip" would hand out every label, and a trip holds
 * flight numbers, seat numbers and booking references. "List mine" hands out
 * nothing that was not already yours.
 *
 * The start dialog merges the two, because this list alone was empty in exactly
 * the case that mattered. It lives in the same storage the trip does, so a
 * browser with no stored trip has no stored list either, and the start dialog
 * only ever appears on such a browser.
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

/** One row of the start dialog's list of trips. */
export interface TripChoice {
  code: string;
  label: string;
  /** True for a trip this browser owns, false for one it was handed a code for. */
  mine: boolean;
}

/**
 * What the start dialog offers: the trips owned here, then the ones this
 * browser was given a code for and does not own.
 *
 * The server's answer leads because it carries the document, and a label built
 * from the document is the one worth reading. The row's stored `label` is only
 * a fallback for a trip whose document did not come back, and it is the older
 * "China 2026, 17 Sep 2026" shape rather than the cities and the month.
 *
 * Deduplicated on the code, so a trip both owned here and remembered locally
 * appears once, described by the server's copy.
 */
export function tripChoices(
  owned: { code: string; label: string | null; itinerary: Itinerary | null }[],
  known: KnownTrip[],
  catalog?: Catalog,
): TripChoice[] {
  const byCode = new Map<string, TripChoice>();
  for (const trip of owned) {
    if (!trip.code) continue;
    byCode.set(trip.code, {
      code: trip.code,
      label: trip.itinerary
        ? describeTrip(trip.itinerary, catalog)
        : trip.label?.trim() || 'Trip',
      mine: true,
    });
  }
  for (const trip of known) {
    if (!trip.code || byCode.has(trip.code)) continue;
    byCode.set(trip.code, { code: trip.code, label: trip.label, mine: Boolean(trip.mine) });
  }
  return [...byCode.values()];
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
