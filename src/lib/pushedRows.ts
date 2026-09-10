import { get, set, del } from 'idb-keyval';

/**
 * What this device last successfully pushed, per list.
 *
 * The third copy `mergeRows` needs. Without it, a row that is here and not on
 * the server is either one added here or one deleted elsewhere, and nothing can
 * tell which; with it, both are ordinary and decidable. It is the rows what
 * `syncMeta` is to the trip document, and exists for exactly the same reason.
 *
 * Written only after a push the server accepted. Writing it optimistically --
 * at the moment of the edit, say -- would record an agreement that never
 * happened, and the next merge would read a failed push as a deletion made
 * elsewhere and delete the rows locally to match.
 */

const KEY = (list: string) => `itinerary-builder/pushed/${list}/v1`;

/** Null for "no record", which callers must not round down to an empty list. */
export async function readPushed<T>(list: string): Promise<T[] | null> {
  try {
    const stored = await get<T[]>(KEY(list));
    return Array.isArray(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function writePushed<T>(list: string, rows: T[]): Promise<void> {
  try {
    await set(KEY(list), rows);
  } catch (cause) {
    // Not fatal. A missing record makes the next merge conservative -- it keeps
    // everything and deletes nothing -- which is the right way to degrade.
    console.warn(`Could not record what was last synced for ${list}.`, cause);
  }
}

/**
 * Drop the record entirely.
 *
 * For switching trips, where what was last agreed is about the trip being left
 * and is worse than useless against the one being opened: it names rows the new
 * trip has never had, and a merge reading those absences as deletions would
 * delete real rows to match. No record makes the next merge conservative --
 * keep everything, delete nothing -- which is the only safe thing to be when
 * the question is unanswerable.
 */
export async function forgetPushed(list: string): Promise<void> {
  try {
    await del(KEY(list));
  } catch {
    // Nothing to do, and nothing lost: a stale record only ever makes the next
    // merge more cautious than it needs to be.
  }
}
