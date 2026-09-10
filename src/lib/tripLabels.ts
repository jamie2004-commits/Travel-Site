import type { Catalog } from './catalog';
import type { Itinerary } from '../types';

/**
 * Naming a trip so a person can pick it out of a list.
 *
 * All that survives of `knownTrips.ts`, which held the codes this browser had
 * been given and the list built from them. Codes are gone -- an account lists
 * its own trips on every device now, and `myTrips()` is the whole answer -- but
 * the labelling was never about codes. A row still has to say which trip it is,
 * and the stored `label` is the older "China 2026, 17 Sep 2026" shape written
 * once at save time. This reads the document instead, so the label is current.
 */

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
