import { get, set, del } from 'idb-keyval';

/**
 * The code for the trip this browser is working on.
 *
 * A trip row belongs to whichever browser created it, and with anonymous sign
 * ins that is one browser and no other. The code is what makes a trip reachable
 * from a second machine: knowing it is the permission, the way a document link
 * works. It is a random uuid rather than the date and the city, because a
 * readable key is a guessable one and a trip holds flight numbers, seat
 * numbers, hotel phone numbers and booking references.
 *
 * Kept in this browser so it does not have to be typed twice, and shown in the
 * app so it can be carried to the other machine.
 */

const KEY = 'itinerary-builder/trip-code/v1';

export async function readTripCode(): Promise<string | null> {
  try {
    return (await get<string>(KEY)) ?? null;
  } catch {
    return null;
  }
}

export async function writeTripCode(code: string): Promise<void> {
  try {
    await set(KEY, code);
  } catch (cause) {
    console.warn('Could not remember the trip code.', cause);
  }
}

export async function forgetTripCode(): Promise<void> {
  try {
    await del(KEY);
  } catch {
    // Nothing to do. The code is recoverable from the trip itself.
  }
}
