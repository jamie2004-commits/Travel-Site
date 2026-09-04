/**
 * Every key this app writes in the browser, in one place.
 *
 * They were four literals in four modules, and `backup.ts` held a fifth copy of
 * each. Renaming one would compile, ship, and quietly produce backups missing
 * that section, which is the worst bug this feature could have: a backup that
 * looks fine and is not. Now there is one definition, and a rename is a
 * compile error at every use.
 */

export const TRIP_KEY = 'itinerary-builder/v1';
export const EXPENSES_KEY = 'itinerary-builder/expenses/v1';
export const RATE_KEY = 'itinerary-builder/expenses/rate/v1';
export const USER_PLACES_KEY = 'itinerary-builder/user-places/v1';

/** Everything a backup carries, so nothing can be added and then forgotten. */
export const ALL_KEYS = [TRIP_KEY, EXPENSES_KEY, RATE_KEY, USER_PLACES_KEY] as const;
