import type { ChecklistItem, ListKind } from './checklist';
import { LIST_KINDS } from './checklist';
import { supabase } from './supabase';
import { ensureIdentity } from './identity';
import { readTripCode } from './tripCode';

/**
 * The packing and preparation lists, on the server.
 *
 * Modelled on the ledger: pushed on a debounce, and read back only when a trip
 * is opened by its code. There is deliberately no background pull, because a
 * pull on a timer beside a reconcile on a timer is a race with data loss at the
 * end of it. The reconcile sends "these are all the rows there are", so a pull
 * that fails and reports an empty list makes the next reconcile delete
 * everything on the server. Reading only at open removes the race rather than
 * narrowing it.
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

  const trip = await client.from('itineraries').select('id').eq('is_active', true).maybeSingle();
  const itineraryId = (trip.data?.id as string | undefined) ?? null;

  // A trip opened by code belongs to another browser, so its rows are out of
  // reach of the owner scoped table exactly as the trip itself was. One call
  // replaces the lists for that trip and nothing else.
  const code = await readTripCode();
  if (code) {
    const rpc = await client.rpc('save_trip_checklist', {
      p_code: code,
      p_rows: items.map(rowOf),
    });
    if (rpc.error) return { ok: false, ...describe(rpc.error.code, rpc.error.message) };
    return { ok: true, savedAt: new Date().toISOString() };
  }

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
 * The lists for a trip being opened by its code.
 *
 * Null means the read failed, and that is not the same answer as a trip with
 * empty lists. The caller writes what comes back straight into storage, so
 * rounding a failure down to [] would replace whatever is in this browser with
 * nothing. Same distinction the trip, the ledger and the places all draw.
 */
export async function openChecklistByCode(code: string): Promise<ChecklistItem[] | null> {
  const identity = await ensureIdentity();
  if (identity.kind !== 'cloud' || !supabase) return null;

  const { data, error } = await supabase.rpc('open_trip_checklist', { p_code: code });
  if (error) {
    // Quiet on a missing function: it means 0010 has not been run, which is a
    // setup state rather than a fault, and the trip still opens without it.
    if (error.code !== MISSING_FUNCTION && error.code !== MISSING_TABLE) {
      console.warn('Could not read the lists for that trip.', error.message);
    }
    return null;
  }
  return (Array.isArray(data) ? data : []).map((row, i) =>
    itemOf(row as Record<string, unknown>, i),
  );
}
