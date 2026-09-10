import { supabase } from './supabase';
import { ensureIdentity } from './identity';
import type { Backup } from './backup';
import { BACKUP_VERSION } from './backup';
import type { Itinerary } from '../types';
import type { Expense } from './expenses';
import type { ChecklistItem } from './checklist';
import { readChecklistForTrip } from './cloudChecklist';
import { readOpenTripId, writeOpenTripId } from './openTrip';

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
 * Write the trip, the ledger and the rate to the trip this device has open.
 *
 * Updates the row this device points at, and starts one when it points at
 * nothing. It is not an upsert on a slot any more: 0011 dropped the one-active-
 * per-owner index so an account can hold several trips, which means the row has
 * to be named rather than found. The ledger goes in beside it as rows, keyed on
 * the id it already has in the browser, so saving twice updates rather than
 * duplicating.
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

  // Which row this is comes from this device's pointer. Until 0011 there was
  // one active row per owner and `where is_active` found it without being told;
  // that slot was dropped precisely so a laptop and a phone can sit on
  // different trips, and the cost is that every caller now has to say which.
  //
  // No pointer means this device has not chosen a trip, so there is nothing to
  // update and the insert below starts one.
  const openId = await readOpenTripId();
  const existing = openId
    ? await supabase.from('itineraries').select('id, version').eq('id', openId).maybeSingle()
    : { data: null as { id: string; version: number } | null, error: null };

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

  // A row this call created is the trip this device is on from here. Without
  // this the next save would not find it either, and "Save to the database"
  // twice would leave two trips that are each half the history.
  if (!existing.data) await writeOpenTripId(written.data.id as string);

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

  // The trip this device has open, rather than "the" trip: since 0011 an
  // account may hold several and the server has no opinion about which is
  // current. Nothing open is not a failure -- it is a device that has not
  // chosen yet -- so it reads as "no backup here" exactly like an empty server.
  const openId = await readOpenTripId();
  if (!openId) return { ok: true, backup: null };

  const trip = await supabase
    .from('itineraries')
    .select('id, doc, version, updated_at')
    .eq('id', openId)
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

/** One of the account's trips, as offered in the trip list. */
export interface OwnedTrip {
  /** The row id. What a device stores to say "this is the trip I am on". */
  id: string;
  /** What the server holds. Superseded by a label built from the doc when there is one. */
  label: string | null;
  itinerary: Itinerary | null;
  savedAt: string;
}

/**
 * The trips this account owns, newest first.
 *
 * Safe to ask because row level security scopes `itineraries` to
 * `owner_id = auth.uid()`: another account asking the same question gets its
 * own list and nothing of yours. That is a different question from "list every
 * trip", which really would hand out every label.
 *
 * This is the whole trip list now. Before email sign in it could only ever
 * describe trips the *browser* had made, because an anonymous identity is one
 * browser -- which is why there used to be a box for pasting a code underneath
 * it, and why that box was the only thing that worked on a second device. With
 * one identity across devices this answer is the same on all of them, and the
 * box is gone.
 *
 * Filtered rather than trusted to be all trips. `itineraries` also holds
 * imported backups, which carry `source = 'local-backup'` and `is_active =
 * false`; before this filter they appeared in the list as ordinary trips, so
 * restoring a backup put a second, older, identically named trip in the picker
 * with nothing to tell them apart.
 */
export async function myTrips(): Promise<{ trips: OwnedTrip[]; failed: boolean }> {
  const identity = await ensureIdentity();
  if (identity.kind !== 'cloud' || !supabase) return { trips: [], failed: false };

  const { data, error } = await supabase
    .from('itineraries')
    .select('id, label, doc, updated_at')
    .eq('is_active', true)
    .eq('source', 'app')
    .order('updated_at', { ascending: false })
    .limit(50);

  // Distinguished rather than swallowed. An empty list and a failed request look
  // identical on screen otherwise, and they call for opposite things: one means
  // make a trip, the other means try again. Saying "no trips" to someone whose
  // request failed is the app lying about their data.
  if (error || !data) return { trips: [], failed: true };

  const trips = data
    .map((r) => ({
      id: (r.id as string) ?? '',
      label: (r.label as string | null) ?? null,
      itinerary: (r.doc as unknown as Itinerary | null) ?? null,
      savedAt: (r.updated_at as string) ?? '',
    }))
    .filter((t) => t.id !== '');

  return { trips, failed: false };
}

export interface OpenedTrip {
  id: string;
  /** The ledger, which travels with the trip rather than with a browser. */
  expenses: Expense[];
  /**
   * The packing and preparation lists, which travel with it too. Null when
   * they could not be read, which is not the same as a trip that has none:
   * the caller writes what it is given straight into storage, so a failure
   * rounded down to an empty list would replace this browser's lists with
   * nothing. Null on a project that has not run 0010 as well.
   */
  checklist: ChecklistItem[] | null;
  itinerary: Itinerary;
  version: number;
  label: string | null;
  updatedAt: string;
}

/**
 * Everything needed to switch this device onto one of the account's trips.
 *
 * An ordinary select, which is the point. The old `openTripByCode` had to go
 * through a `security definer` function because the row belonged to a different
 * anonymous identity and row level security would hide it; with one account
 * across devices the row is simply yours, and the policy from 0006 returns it.
 *
 * The ledger and the lists come too. A trip that arrived with its days and none
 * of what it cost is half a trip, and that was true when a code carried it
 * across and is still true now.
 */
export async function openTripById(id: string): Promise<
  { ok: true; trip: OpenedTrip } | { ok: false; message: string }
> {
  const identity = await ensureIdentity();
  if (identity.kind !== 'cloud' || !supabase) {
    return { ok: false, message: 'Not connected to the database.' };
  }

  const { data, error } = await supabase
    .from('itineraries')
    .select('id, doc, version, label, updated_at')
    .eq('id', id)
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  // Reads as "no such trip" rather than "no permission", because row level
  // security makes those the same answer and the difference is neither
  // something the app can see nor something the reader could act on.
  if (!data) return { ok: false, message: 'That trip is no longer there.' };

  const ledger = await supabase
    .from('expenses')
    .select('local_id, spent_on, category, label, amount, currency, people, note')
    .eq('itinerary_id', id);

  const checklist = await readChecklistForTrip(id);

  const expenses: Expense[] = (ledger.data ?? []).map((r, i) => ({
    id: (r.local_id as string) ?? `exp-opened-${i}`,
    date: (r.spent_on as string | null) ?? undefined,
    category: r.category as Expense['category'],
    label: (r.label as string) ?? '',
    amount: Number(r.amount) || 0,
    currency: (r.currency as Expense['currency']) ?? 'CNY',
    people: (r.people as number | null) ?? undefined,
    note: (r.note as string | null) ?? undefined,
  }));

  return {
    ok: true,
    trip: {
      id: data.id as string,
      expenses,
      checklist,
      itinerary: data.doc as unknown as Itinerary,
      version: (data.version as number) ?? 1,
      label: (data.label as string | null) ?? null,
      updatedAt: (data.updated_at as string) ?? '',
    },
  };
}

/**
 * The ledger filed against one trip.
 *
 * Null means the read failed, which is not the same as a trip with no expenses,
 * and the difference is the whole reason the pull on load is safe: a failure
 * rounded down to [] would arm a reconcile that deletes every row on the
 * server. Same distinction the lists draw, for the same reason.
 */
export async function readExpensesForTrip(
  itineraryId: string | null,
): Promise<Expense[] | null> {
  const identity = await ensureIdentity();
  if (identity.kind !== 'cloud' || !supabase) return null;

  const query = supabase
    .from('expenses')
    .select('local_id, spent_on, category, label, amount, currency, people, note');
  // `.is(null)` and not `.eq(null)`, which PostgREST reads as a comparison to
  // the string "null" and quietly matches nothing.
  const { data, error } = await (itineraryId
    ? query.eq('itinerary_id', itineraryId)
    : query.is('itinerary_id', null));

  if (error) {
    if (error.code !== MISSING_TABLE) {
      console.warn('Could not read the ledger for that trip.', error.message);
    }
    return null;
  }

  return (data ?? []).map((r, i) => ({
    id: (r.local_id as string) ?? `exp-read-${i}`,
    date: (r.spent_on as string | null) ?? undefined,
    category: r.category as Expense['category'],
    label: (r.label as string) ?? '',
    amount: Number(r.amount) || 0,
    currency: (r.currency as Expense['currency']) ?? 'CNY',
    people: (r.people as number | null) ?? undefined,
    note: (r.note as string | null) ?? undefined,
  }));
}

/**
 * Start a trip on the server and hand back its id.
 *
 * An insert rather than an upsert, and one that can now succeed more than once:
 * 0006's partial unique index made a second live trip per owner an error, and
 * 0011 dropped it so that "keep this one and plan another" is an ordinary act
 * rather than a schema change.
 */
export async function createTrip(
  itinerary: Itinerary,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const identity = await ensureIdentity();
  if (identity.kind !== 'cloud' || !supabase) {
    return { ok: false, message: 'Not connected to the database.' };
  }

  const { data, error } = await supabase
    .from('itineraries')
    .insert({
      doc: itinerary as unknown as Record<string, unknown>,
      label: tripLabel(itinerary),
      is_active: true,
      source: 'app',
      client_id: thisBrowser(),
      client_updated_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, message: describe(error.code, error.message).message };
  if (!data) return { ok: false, message: 'The trip was not created.' };
  return { ok: true, id: data.id as string };
}

/**
 * Delete a trip and everything filed against it.
 *
 * The expenses and checklist rows are not cascaded away by the schema. Both
 * carry `on delete set null`, deliberately, because "passport" outlives the
 * plan it was written for. That is right for a trip being replanned and wrong
 * for one being deleted on purpose, where leaving them behind means rows no
 * trip will ever show again. So they go explicitly, first, while the id still
 * joins them.
 */
export async function deleteTrip(id: string): Promise<{ ok: boolean; message?: string }> {
  const identity = await ensureIdentity();
  if (identity.kind !== 'cloud' || !supabase) {
    return { ok: false, message: 'Not connected to the database.' };
  }

  await supabase.from('expenses').delete().eq('itinerary_id', id);
  await supabase.from('trip_checklist').delete().eq('itinerary_id', id);

  const { error } = await supabase.from('itineraries').delete().eq('id', id);
  if (error) return { ok: false, message: describe(error.code, error.message).message };
  return { ok: true };
}

/** Rename a trip, for telling two of them apart in the list. */
export async function renameTrip(
  id: string,
  label: string,
): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: 'Not connected to the database.' };
  const { error } = await supabase
    .from('itineraries')
    .update({ label: label.slice(0, 200) })
    .eq('id', id);
  if (error) return { ok: false, message: describe(error.code, error.message).message };
  return { ok: true };
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
  const itineraryId = await readOpenTripId();

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
  const theirs = itineraryId
    ? await supabase.from('expenses').select('local_id').eq('itinerary_id', itineraryId)
    : await supabase.from('expenses').select('local_id').is('itinerary_id', null);
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
