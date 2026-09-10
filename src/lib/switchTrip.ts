import { openTripById } from './cloudTrip';
import { writeOpenTripId } from './openTrip';
import { writeOpenedTrip } from './backup';
import { writeSyncMeta } from './syncMeta';
import { writePushed, forgetPushed } from './pushedRows';

/**
 * Put this device on one of the account's trips.
 *
 * Five things have to move together, and the reason this is one function rather
 * than five calls at the call site is that any subset of them is a corrupt
 * state. Three of the five are bookkeeping nobody looks at, which is exactly
 * why they get forgotten:
 *
 *   The pointer, so the next load opens this trip rather than the last one.
 *
 *   The documents, into the storage every page reads from.
 *
 *   `syncMeta`, which is what the trip layer compares against to tell an
 *   unpushed edit from a stale copy. Left holding the *previous* trip's version
 *   and document, the first thing the new trip does is decide both sides have
 *   moved and raise a conflict between two unrelated trips.
 *
 *   The two `pushedRows` records, which are what `mergeRows` uses to tell a row
 *   added here from one deleted elsewhere. Left holding the previous trip's
 *   rows, every row of the new trip is missing from the record, the merge reads
 *   that as deletions, and it deletes them to match. This is the one that
 *   silently destroys data, and it is the least obvious of the five.
 *
 * Then the caller reloads. The sync layer settles from a clean start rather
 * than mid-flight, which is what the code-era open did too and for the same
 * reason.
 */
export async function switchToTrip(
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const opened = await openTripById(id);
  if (!opened.ok) return opened;
  const { itinerary, expenses, checklist, version, updatedAt } = opened.trip;

  await writeOpenedTrip(itinerary, expenses, checklist);
  await writeOpenTripId(id);
  await writeSyncMeta({
    version,
    doc: itinerary,
    savedAt: updatedAt || new Date().toISOString(),
  });

  // What just came back IS what this device has agreed with the server, so it
  // is the record, exactly. No push is needed to earn it.
  await writePushed('expenses', expenses);
  if (checklist !== null) {
    await writePushed('checklist', checklist);
  } else {
    // The lists could not be read, so there is no agreement to record and the
    // previous trip's must not stand in for one. Forgetting makes the next
    // merge keep everything and delete nothing, which is the right way to be
    // wrong here.
    await forgetPushed('checklist');
  }

  return { ok: true };
}
