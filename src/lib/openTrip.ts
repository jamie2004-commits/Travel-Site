import { get, set, del } from 'idb-keyval';
import { OPEN_TRIP_KEY } from './storageKeys';

/**
 * Which of the account's trips this device is working on.
 *
 * This is what replaced `where is_active`. Until 0011 the server held one
 * active trip per owner and every query asked for "the" trip, which worked
 * exactly as long as an owner was a browser. Once an account spans a laptop
 * and a phone, one active row per account means both devices must have the
 * same trip open and switching on one switches it under the other, mid-edit.
 *
 * So the choice moves to where it belongs. The server keeps every trip and has
 * no opinion about which is current; each device remembers an id and asks for
 * that row by name. Two devices can sit on two different trips, and neither can
 * pull the other off the one it is editing.
 *
 * Null means this device has not chosen yet, which is a real and ordinary
 * state -- a fresh browser, or one that just signed in to an account whose
 * trips it has never seen. It is not an error and it is not "no trips". The
 * app asks; it does not guess.
 */

export async function readOpenTripId(): Promise<string | null> {
  try {
    return (await get<string>(OPEN_TRIP_KEY)) ?? null;
  } catch {
    return null;
  }
}

export async function writeOpenTripId(id: string): Promise<void> {
  try {
    await set(OPEN_TRIP_KEY, id);
  } catch (cause) {
    // Worth a warning rather than silence. Sync keeps working for this session
    // because the id is held in memory too, and the next load asks again.
    console.warn('Could not remember which trip is open on this device.', cause);
  }
}

/**
 * Stop pointing at a trip, without touching the trip.
 *
 * Called when signing in on a device joining an account -- the trip it was
 * pointing at belonged to the identity it just left -- and when the open trip
 * is deleted. Never called to "clean up": a device with no open trip is asked
 * which one it wants, and asking someone that for no reason is worse than the
 * stale pointer it fixes.
 */
export async function forgetOpenTripId(): Promise<void> {
  try {
    await del(OPEN_TRIP_KEY);
  } catch {
    // Nothing to do. A stale id resolves to a trip that no longer opens, and
    // the caller already has to handle that case for a deleted trip.
  }
}
