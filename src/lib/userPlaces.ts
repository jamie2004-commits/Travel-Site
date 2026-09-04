import { get, set } from 'idb-keyval';
import type { Place } from '../types';

import { USER_PLACES_KEY as KEY } from './storageKeys';

/**
 * Places added in the app. They live in the browser, not in Supabase: the
 * catalog table is readable by anyone but writable only by a signed in user,
 * and there is no sign in yet. When there is, these are what gets pushed up.
 *
 * Null means the read failed, which is not the same as an empty list and must
 * not be rounded down to one. Returning [] on failure, as this used to, made
 * the next add or remove write a one item list over places that were on disk
 * and merely unreadable. Same defect the trip and the ledger had.
 */
export async function loadUserPlaces(): Promise<Place[] | null> {
  try {
    const stored = await get<Place[]>(KEY);
    if (stored === undefined) return [];
    if (!Array.isArray(stored)) {
      console.error('The stored places are not a list. They will not be changed.', stored);
      return null;
    }
    return stored;
  } catch (cause) {
    console.error('Could not read the places saved in this browser.', cause);
    return null;
  }
}

export async function saveUserPlaces(places: Place[]): Promise<void> {
  try {
    await set(KEY, places);
  } catch (cause) {
    // A private window with storage blocked. The place stays for this session.
    console.error('Could not save places to this browser.', cause);
  }
}

/** Kept in this browser only. There is no row in Postgres behind it. */
export const isLocalPlace = (place: Place) => place.id.startsWith('user:');

/**
 * Whether this person may edit or delete it.
 *
 * This is deliberately the same test the delete and update policies apply in
 * 0001, so the control on screen and the answer from the database can never
 * disagree. The database is still the one deciding; this only decides what to
 * draw.
 *
 * Keyed on createdBy and not on source, because the two can disagree: a re-run
 * of seed.sql rewrites source on a colliding row while leaving createdBy alone,
 * and keying on source would then quietly take away someone's ability to delete
 * their own place while RLS still allowed it.
 *
 * A seeded place has createdBy null, and null never equals a uuid, so no amount
 * of being signed in makes one editable.
 */
export function canEditPlace(place: Place, userId: string | null): boolean {
  if (isLocalPlace(place)) return true;
  return userId !== null && place.createdBy != null && place.createdBy === userId;
}

/** Someone added this in the app, whoever they were. For the card's label. */
export const isAddedPlace = (place: Place) => isLocalPlace(place) || place.source === 'user';

export function newUserPlaceId() {
  return `user:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
