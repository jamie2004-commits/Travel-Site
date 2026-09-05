import { supabase } from './supabase';
import { ensureIdentity } from './identity';
import type { Backup } from './backup';
import { BACKUP_VERSION } from './backup';
import type { Itinerary } from '../types';
import type { Expense } from './expenses';
import { readTripCode, writeTripCode } from './tripCode';

/**
 * Saving a copy of the trip to the database, and getting it back.
 *
 * Deliberately manual: two buttons, nothing automatic. Every mechanism that
 * could lose a trip lives in automatic syncing, and none of it is here. Nothing
 * is written unless asked, nothing is replaced without a confirmation naming
 * both sides, and a failure leaves both copies exactly as they were.
 *
 * That is the whole point of doing this before the sync layer rather than
 * after: it is the smallest thing that makes losing the trip impossible, and it
 * needs none of the machinery that could itself lose it.
 */

/** Where a save went, or why it did not. */
export type SaveOutcome =
  | { ok: true; version: number; savedAt: string }
  | { ok: false; message: string; kind: 'local' | 'missing-table' | 'refused' | 'failed' };

export type LoadOutcome =
  | { ok: true; backup: Backup; version: number; savedAt: string }
  | { ok: true; backup: null }
  | { ok: false; message: string; kind: 'local' | 'missing-table' | 'failed' };

/**
 * 42P01 is "relation does not exist", which during rollout is far and away the
 * likeliest failure: the client shipped before the migration was run. Saying so
 * beats a raw Postgres string about a relation nobody has heard of.
 */
const MISSING_TABLE = '42P01';

function describe(code: string | undefined, message: string): {
  message: string;
  kind: 'missing-table' | 'refused' | 'failed';
} {
  if (code === MISSING_TABLE) {
    return {
      kind: 'missing-table',
      message: 'The database is not set up for saving trips yet. Run supabase/migrations/0006_itinerary.sql.',
    };
  }
  if (code === '42501' || code === 'PGRST301') {
    return { kind: 'refused', message: 'This browser is not allowed to save. Reload and try again.' };
  }
  if (code === '23514') {
    return { kind: 'failed', message: 'The trip is too large or malformed to save.' };
  }
  return { kind: 'failed', message: message || 'Could not reach the database.' };
}

/**
 * Write the trip, the ledger and the rate as this browser's active trip.
 *
 * One row per person, found by `is_active`, so this is an upsert on a slot
 * rather than an insert that piles up copies. The ledger goes in beside it as
 * rows, keyed on the id it already has in the browser, so saving twice updates
 * rather than duplicating.
 */
export async function saveToCloud(
  itinerary: Itinerary,
  expenses: Expense[],
  rate: number,
): Promise<SaveOutcome> {
  const identity = await ensureIdentity();
  if (identity.kind !== 'cloud' || !supabase) {
    return {
      ok: false,
      kind: 'local',
      message: 'Not connected to the database, so there is nowhere to save a copy.',
    };
  }

  const clientId = thisBrowser();

  // The trip. Read the active row first rather than blind-upserting, because
  // the partial unique index on (owner_id) where is_active makes a second
  // insert an error rather than a replacement, and that error is the thing
  // stopping two devices quietly forking the trip.
  const existing = await supabase
    .from('itineraries')
    .select('id, version')
    .eq('is_active', true)
    .maybeSingle();

  if (existing.error) {
    const d = describe(existing.error.code, existing.error.message);
    return { ok: false, ...d };
  }

  const row = {
    doc: itinerary as unknown as Record<string, unknown>,
    client_id: clientId,
    client_updated_at: new Date().toISOString(),
    source: 'app',
  };

  const written = existing.data
    ? await supabase
        .from('itineraries')
        .update(row)
        .eq('id', existing.data.id)
        .select('id, version, updated_at')
        .maybeSingle()
    : await supabase
        .from('itineraries')
        .insert({ ...row, is_active: true })
        .select('id, version, updated_at')
        .maybeSingle();

  if (written.error) {
    const d = describe(written.error.code, written.error.message);
    return { ok: false, ...d };
  }
  if (!written.data) {
    return {
      ok: false,
      kind: 'failed',
      message: 'The trip was not saved. It may have been changed on another device.',
    };
  }

  // The ledger. Upserted on (owner_id, local_id), so a second save of the same
  // rows updates them rather than adding a second copy of everything.
  if (expenses.length) {
    const rows = expenses.map((e) => ({
      itinerary_id: written.data!.id as string,
      local_id: e.id,
      spent_on: e.date && e.date.trim() ? e.date : null,
      category: e.category,
      label: e.label ?? '',
      // Postgres numeric rejects NaN through PostgREST, and an amount that is
      // not a number is a zero everywhere else in the app too.
      amount: Number.isFinite(e.amount) ? e.amount : 0,
      currency: e.currency ?? 'CNY',
      people: e.people ?? null,
      note: e.note ?? null,
      client_id: clientId,
    }));
    const ledger = await supabase
      .from('expenses')
      .upsert(rows, { onConflict: 'owner_id,local_id' });
    if (ledger.error) {
      const d = describe(ledger.error.code, ledger.error.message);
      return { ok: false, ...d, message: `The trip was saved, but the expenses were not. ${d.message}` };
    }
  }

  // The rate, on the person rather than the trip: an expense whose trip is
  // deleted still has to be worth something.
  const settings = await supabase
    .from('user_settings')
    .upsert({ fx_rates: { CNY: rate } }, { onConflict: 'user_id' });
  if (settings.error) {
    // Not fatal. The trip and the ledger are the things worth protecting, and
    // the rate is one editable number with a sane default.
    console.warn('Could not save the exchange rate.', settings.error.message);
  }

  return {
    ok: true,
    version: (written.data.version as number) ?? 1,
    savedAt: (written.data.updated_at as string) ?? new Date().toISOString(),
  };
}

/** Read back whatever this browser last saved, in the shape a restore wants. */
export async function loadFromCloud(): Promise<LoadOutcome> {
  const identity = await ensureIdentity();
  if (identity.kind !== 'cloud' || !supabase) {
    return { ok: false, kind: 'local', message: 'Not connected to the database.' };
  }

  const trip = await supabase
    .from('itineraries')
    .select('id, doc, version, updated_at')
    .eq('is_active', true)
    .maybeSingle();

  if (trip.error) {
    const d = describe(trip.error.code, trip.error.message);
    return { ok: false, kind: d.kind === 'refused' ? 'failed' : d.kind, message: d.message };
  }
  if (!trip.data) return { ok: true, backup: null };

  const ledger = await supabase
    .from('expenses')
    .select('local_id, spent_on, category, label, amount, currency, people, note')
    .eq('itinerary_id', trip.data.id);

  const settings = await supabase.from('user_settings').select('fx_rates').maybeSingle();

  const expenses: Expense[] = (ledger.data ?? []).map((r, i) => ({
    id: (r.local_id as string) ?? `exp-restored-${i}`,
    date: (r.spent_on as string | null) ?? undefined,
    category: r.category as Expense['category'],
    label: (r.label as string) ?? '',
    amount: Number(r.amount) || 0,
    currency: (r.currency as Expense['currency']) ?? 'CNY',
    people: (r.people as number | null) ?? undefined,
    note: (r.note as string | null) ?? undefined,
  }));

  const rates = settings.data?.fx_rates as { CNY?: number } | undefined;

  return {
    ok: true,
    backup: {
      format: 'itinerary-builder/backup',
      version: BACKUP_VERSION,
      savedAt: (trip.data.updated_at as string) ?? new Date().toISOString(),
      itinerary: trip.data.doc as unknown as Itinerary,
      expenses,
      rate: typeof rates?.CNY === 'number' && rates.CNY > 0 ? rates.CNY : undefined,
      // Deliberately absent rather than empty: places added in this browser are
      // not part of a trip, and an empty list here would delete them on restore.
      userPlaces: undefined,
    },
    version: (trip.data.version as number) ?? 1,
    savedAt: (trip.data.updated_at as string) ?? new Date().toISOString(),
  };
}

/**
 * A short human label for a trip, so a list of them can be told apart.
 *
 * Deliberately not a key. It is guessable by design, which is the whole reason
 * the code beside it is a random uuid instead.
 */
export function tripLabel(itinerary: Itinerary): string {
  const dated = itinerary.days.find((d) => d.date)?.date;
  const when = dated
    ? new Date(`${dated}T00:00:00`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '';
  const name = itinerary.name?.trim() || 'Trip';
  return when ? `${name}, ${when}` : name;
}

/**
 * The code that opens this browser's trip somewhere else.
 *
 * Read from the server rather than remembered, because a trip only has a code
 * once it has reached the server, and the browser that created it never needed
 * one to read its own row. A trip that was itself opened by a code already has
 * one stored, and that is returned as-is.
 */
export async function tripCodeForThisTrip(): Promise<string | null> {
  const known = await readTripCode();
  if (known) return known;

  const identity = await ensureIdentity();
  if (identity.kind !== 'cloud' || !supabase) return null;

  const { data } = await supabase
    .from('itineraries')
    .select('share_code')
    .eq('is_active', true)
    .maybeSingle();
  const code = (data?.share_code as string | undefined) ?? null;
  // Kept so the next ask does not need a round trip, and so the sync layer can
  // see it. Harmless for the owning browser, which does not need it to write.
  if (code) await writeTripCode(code);
  return code;
}

export interface OpenedTrip {
  id: string;
  itinerary: Itinerary;
  version: number;
  label: string | null;
  updatedAt: string;
}

/**
 * Open a trip by its code, from any browser.
 *
 * Goes through the `open_trip` function rather than selecting the table,
 * because the row belongs to whichever browser created it and row level
 * security would hide it from everyone else. The function runs as its owner and
 * takes the code as its only argument, so knowing the code is the permission.
 */
export async function openTripByCode(code: string): Promise<
  { ok: true; trip: OpenedTrip } | { ok: false; message: string }
> {
  const identity = await ensureIdentity();
  if (identity.kind !== 'cloud' || !supabase) {
    return { ok: false, message: 'Not connected to the database.' };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code.trim())) {
    return { ok: false, message: 'That is not a trip code. It looks like 8-4-4-4-12 characters.' };
  }

  const { data, error } = await supabase.rpc('open_trip', { p_code: code.trim() });
  if (error) {
    return {
      ok: false,
      message:
        error.code === '42883'
          ? 'This project does not have trip codes yet. Run supabase/migrations/0008_trip_codes.sql.'
          : error.message,
    };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, message: 'No trip has that code.' };

  return {
    ok: true,
    trip: {
      id: row.id as string,
      itinerary: row.doc as unknown as Itinerary,
      version: (row.version as number) ?? 1,
      label: (row.label as string | null) ?? null,
      updatedAt: (row.updated_at as string) ?? '',
    },
  };
}

/**
 * Reconcile the ledger with the server: every row here written up, and any row
 * there that is no longer here removed.
 *
 * A full reconcile rather than a diff, because a ledger is tens of rows and the
 * alternative is tracking deletions locally so they can be replayed. Deleting a
 * row and then syncing has to actually delete it, and the cheapest correct way
 * to say that is "these are all the rows there are".
 *
 * Rows, not a document, so there is no version and no compare and swap: two
 * devices adding two different receipts both keep them, which is the whole
 * reason the schema made this a table.
 */
export async function syncExpenses(expenses: Expense[], rate: number): Promise<SaveOutcome> {
  const identity = await ensureIdentity();
  if (identity.kind !== 'cloud' || !supabase) {
    return { ok: false, kind: 'local', message: 'Not connected to the database.' };
  }
  const clientId = thisBrowser();

  // The trip this ledger belongs to, if there is one. Nullable by design: an
  // expense outlives the plan it was filed against.
  const trip = await supabase
    .from('itineraries')
    .select('id')
    .eq('is_active', true)
    .maybeSingle();
  const itineraryId = (trip.data?.id as string | undefined) ?? null;

  if (expenses.length) {
    const rows = expenses.map((e) => ({
      itinerary_id: itineraryId,
      local_id: e.id,
      // A date column rejects '', and the type deliberately allows the date to
      // be absent while a row is being typed.
      spent_on: e.date && e.date.trim() ? e.date : null,
      category: e.category,
      label: (e.label ?? '').slice(0, 200),
      amount: Number.isFinite(e.amount) ? e.amount : 0,
      currency: e.currency ?? 'CNY',
      people: e.people && e.people > 0 ? e.people : null,
      note: e.note ? e.note.slice(0, 4000) : null,
      client_id: clientId,
    }));
    const written = await supabase
      .from('expenses')
      .upsert(rows, { onConflict: 'owner_id,local_id' });
    if (written.error) {
      const d = describe(written.error.code, written.error.message);
      return { ok: false, ...d };
    }
  }

  // Anything on the server this browser no longer has.
  //
  // Read the ids and delete the difference, rather than sending a "not in
  // (…this list…)" filter built by hand. Hand-building it means quoting every
  // id into a string, and an id carrying a quote character then closes the list
  // early: I tested it, and a row that should have been KEPT was deleted. Ids
  // minted here are `exp-<uuid>` so it cannot happen in practice, but a
  // restored backup can carry anything, and the failure deletes data rather
  // than refusing. `.in()` lets the client do its own encoding.
  const theirs = await supabase.from('expenses').select('local_id');
  if (theirs.error) {
    const d = describe(theirs.error.code, theirs.error.message);
    return { ok: false, ...d };
  }
  const kept = new Set(expenses.map((e) => e.id));
  const gone = (theirs.data ?? [])
    .map((r) => r.local_id as string | null)
    .filter((id): id is string => id !== null && !kept.has(id));

  if (gone.length) {
    const removed = await supabase.from('expenses').delete().in('local_id', gone);
    if (removed.error) {
      const d = describe(removed.error.code, removed.error.message);
      return { ok: false, ...d };
    }
  }

  const settings = await supabase
    .from('user_settings')
    .upsert({ fx_rates: { CNY: rate } }, { onConflict: 'user_id' });
  if (settings.error) {
    console.warn('Could not save the exchange rate.', settings.error.message);
  }

  return { ok: true, version: 1, savedAt: new Date().toISOString() };
}

/**
 * A stable id for this browser, kept beside the trip. Not a credential and
 * never used for authorisation: it is what tells one device's copy from
 * another's when both belong to the same person.
 */
const CLIENT_KEY = 'itinerary-builder/client-id/v1';

function thisBrowser(): string {
  try {
    const found = localStorage.getItem(CLIENT_KEY);
    if (found) return found;
    const minted =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(CLIENT_KEY, minted);
    return minted;
  } catch {
    // Storage blocked. A per-session id is still better than none.
    return `c-session-${Math.random().toString(36).slice(2, 10)}`;
  }
}
