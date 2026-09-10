import type { ChecklistItem, ListKind } from './checklist';
import { LIST_KINDS } from './checklist';
import { supabase } from './supabase';
import { ensureIdentity } from './identity';
import { readOpenTripId } from './openTrip';

/**
 * The packing and preparation lists, on the server.
 *
 * Modelled on the ledger: pushed on a debounce, and read on load.
 *
 * The read used to happen only when a trip was opened by its code, and the
 * reasoning for that was sound as far as it went: the reconcile sends "these
 * are all the rows there are", so a pull that fails and reports an empty list
 * makes the next reconcile delete everything on the server. A pull on a timer
 * beside a reconcile on a timer is a race with data loss at the end of it.
 *
 * What that missed is that never pulling has the same failure without needing
 * a race. A device that has not read since it opened the trip is holding a
 * stale list, and its next push deletes everything added anywhere else. On one
 * browser that never came up. Across a laptop and a phone it is the ordinary
 * case, and it fires on merely opening the app, because the hook that pushes
 * mounts app-wide.
 *
 * So the pull comes back, and the race is closed the way the trip layer closes
 * it rather than by refusing to read: a failed read leaves the pusher disarmed.
 * `readChecklistForTrip` returns null for "could not read", never [], and the
 * caller may not push until a read has actually succeeded. Empty is a fact
 * about the server; null is the absence of one, and the two must never collapse.
 */

export type ChecklistSave =
  | { ok: true; savedAt: string }
  | { ok: false; kind: 'local' | 'missing-table' | 'refused' | 'failed'; message: string };

const MISSING_TABLE = '42P01';
const MISSING_FUNCTION = '42883';

function describe(
  code: string | undefined,
  message: string,
): { kind: 'missing-table' | 'refused' | 'failed'; message: string } {
  if (code === MISSING_TABLE || code === MISSING_FUNCTION) {
    return {
      kind: 'missing-table',
      message: 'This project has no checklist table yet. Run supabase/migrations/0010_checklist.sql.',
    };
  }
  if (code === '42501') {
    return { kind: 'refused', message: 'This browser is not allowed to save these lists.' };
  }
  return { kind: 'failed', message: message || 'Could not reach the database.' };
}

const notConnected = {
  ok: false as const,
  kind: 'local' as const,
  message: 'Not connected to the database, so the lists stay in this browser.',
};

/** The row shape both write paths send, so the two cannot drift apart. */
function rowOf(item: ChecklistItem) {
  return {
    local_id: item.id,
    kind: item.kind,
    label: (item.text ?? '').slice(0, 200),
    done: !!item.done,
    heading: item.group?.trim() ? item.group.trim().slice(0, 60) : null,
    added_at: item.addedAt,
  };
}

/** A stored row back into the app's shape, with the two fields it must have. */
function itemOf(row: Record<string, unknown>, i: number): ChecklistItem {
  const kind = row.kind as ListKind;
  const heading = (row.heading as string | null) ?? '';
  return {
    id: (row.local_id as string) ?? `chk-opened-${i}`,
    // A row whose kind the app does not know belongs to no list on screen and
    // would simply vanish. Landing it in packing keeps it reachable.
    kind: LIST_KINDS.includes(kind) ? kind : 'packing',
    text: (row.label as string) ?? '',
    done: !!row.done,
    ...(heading ? { group: heading } : {}),
    addedAt: row.added_at ? new Date(row.added_at as string).toISOString() : new Date().toISOString(),
  };
}

/**
 * Reconcile the lists with the server: every row here written up, and any row
 * there that is no longer here removed.
 *
 * A full reconcile rather than a diff, for the reason syncExpenses records: an
 * item removed from a packing list has to actually go, and "these are all the
 * rows there are" is the cheapest correct way to say so.
 */
export async function syncChecklist(items: ChecklistItem[]): Promise<ChecklistSave> {
  const identity = await ensureIdentity();
  if (identity.kind !== 'cloud' || !supabase) return notConnected;
  const client = supabase;

  const itineraryId = await readOpenTripId();

  if (items.length) {
    const written = await client
      .from('trip_checklist')
      .upsert(
        items.map((i) => ({ ...rowOf(i), itinerary_id: itineraryId })),
        { onConflict: 'owner_id,local_id' },
      );
    if (written.error) return { ok: false, ...describe(written.error.code, written.error.message) };
  }

  // Read the ids and delete the difference, rather than building a "not in
  // (...)" filter by hand. syncExpenses records why at length: a hand quoted
  // list lets an id containing a quote close the list early and delete a row
  // that should have been kept.
  const theirs = itineraryId
    ? await client.from('trip_checklist').select('local_id').eq('itinerary_id', itineraryId)
    : await client.from('trip_checklist').select('local_id').is('itinerary_id', null);
  if (theirs.error) return { ok: false, ...describe(theirs.error.code, theirs.error.message) };

  const kept = new Set(items.map((i) => i.id));
  const gone = (theirs.data ?? [])
    .map((r) => r.local_id as string | null)
    .filter((id): id is string => id !== null && !kept.has(id));

  if (gone.length) {
    const removed = await client.from('trip_checklist').delete().in('local_id', gone);
    if (removed.error) return { ok: false, ...describe(removed.error.code, removed.error.message) };
  }

  return { ok: true, savedAt: new Date().toISOString() };
}

/**
 * The lists filed against one trip.
 *
 * Null means the read failed, and that is not the same answer as a trip with
 * empty lists. Two callers depend on the difference and both would lose data
 * without it: opening a trip writes what comes back straight into storage, so
 * a failure rounded down to [] would replace this browser's lists with nothing,
 * and the pull on load uses a non-null answer as its permission to start
 * pushing, so a failure rounded down to [] would arm a reconcile that deletes
 * every row on the server. Same distinction the trip, the ledger and the places
 * all draw.
 */
export async function readChecklistForTrip(
  itineraryId: string | null,
): Promise<ChecklistItem[] | null> {
  const identity = await ensureIdentity();
  if (identity.kind !== 'cloud' || !supabase) return null;

  // Rows with no trip are the unfiled ones, which is what a list written before
  // any trip existed looks like. `.is(null)` rather than `.eq(null)`, which
  // PostgREST reads as a comparison to the string "null" and matches nothing.
  const query = supabase
    .from('trip_checklist')
    .select('local_id, kind, label, done, heading, added_at');
  const { data, error } = await (itineraryId
    ? query.eq('itinerary_id', itineraryId)
    : query.is('itinerary_id', null));

  if (error) {
    // Quiet on a missing table: it means 0010 has not been run, which is a
    // setup state rather than a fault, and the trip still opens without it.
    if (error.code !== MISSING_FUNCTION && error.code !== MISSING_TABLE) {
      console.warn('Could not read the lists for that trip.', error.message);
    }
    return null;
  }
  return (data ?? []).map((row, i) => itemOf(row as Record<string, unknown>, i));
}
