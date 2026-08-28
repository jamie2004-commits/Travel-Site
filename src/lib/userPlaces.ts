import { get, set } from 'idb-keyval';
import type { Place } from '../types';

const KEY = 'itinerary-builder/user-places/v1';

/**
 * Places added in the app. They live in the browser, not in Supabase: the
 * catalog table is readable by anyone but writable only by a signed in user,
 * and there is no sign in yet. When there is, these are what gets pushed up.
 */
export async function loadUserPlaces(): Promise<Place[]> {
  try {
    return (await get<Place[]>(KEY)) ?? [];
  } catch {
    return [];
  }
}

export async function saveUserPlaces(places: Place[]): Promise<void> {
  try {
    await set(KEY, places);
  } catch {
    // A private window with storage blocked. The place stays for this session.
  }
}

export const isUserPlace = (place: Place) => place.id.startsWith('user:');

export function newUserPlaceId() {
  return `user:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
