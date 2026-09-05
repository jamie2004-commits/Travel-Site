import { get, setMany } from 'idb-keyval';
import type { Itinerary } from '../types';
import type { Expense } from './expenses';
import type { Place } from '../types';

/**
 * A copy of everything this browser holds, in a form that can be read back.
 *
 * The HTML and text exports render a trip for people. This one is for the app:
 * it round trips, so a downloaded file is an actual backup rather than a
 * printout. Until the trip lives on a server, this file is the only copy that
 * survives the browser clearing its storage, so it deliberately carries the
 * ledger and the added places too, not just the itinerary.
 */

import { EXPENSES_KEY, RATE_KEY, TRIP_KEY, USER_PLACES_KEY as PLACES_KEY } from './storageKeys';

/** Bumped only when the shape changes in a way a reader must know about. */
export const BACKUP_VERSION = 1;

export interface Backup {
  format: 'itinerary-builder/backup';
  version: number;
  savedAt: string;
  itinerary?: Itinerary;
  expenses?: Expense[];
  rate?: number;
  userPlaces?: Place[];
}

/** Everything in storage, read straight rather than through the hooks. */
export async function readBackup(): Promise<Backup> {
  const [itinerary, expenses, rate, userPlaces] = await Promise.all([
    get<Itinerary>(TRIP_KEY),
    get<Expense[]>(EXPENSES_KEY),
    get<number>(RATE_KEY),
    get<Place[]>(PLACES_KEY),
  ]);
  return {
    format: 'itinerary-builder/backup',
    version: BACKUP_VERSION,
    savedAt: new Date().toISOString(),
    itinerary,
    expenses,
    rate,
    userPlaces,
  };
}

export interface BackupSummary {
  days: number;
  stops: number;
  expenses: number;
  places: number;
  /** Whether the file carries a ledger at all. An empty one erases; none keeps. */
  hasExpenses: boolean;
  hasPlaces: boolean;
  savedAt?: string;
  name?: string;
}

/** What a file holds, for a confirmation that names it before replacing anything. */
export function summarise(backup: Backup): BackupSummary {
  const days = backup.itinerary?.days ?? [];
  return {
    days: days.length,
    stops: days.reduce((n, d) => n + (Array.isArray(d?.items) ? d.items.length : 0), 0),
    expenses: backup.expenses?.length ?? 0,
    places: backup.userPlaces?.length ?? 0,
    hasExpenses: backup.expenses !== undefined,
    hasPlaces: backup.userPlaces !== undefined,
    savedAt: backup.savedAt,
    name: backup.itinerary?.name,
  };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Read a file back into a Backup, or explain why it is not one.
 *
 * Strict about the envelope, and strict about anything the app will later
 * iterate. It was lenient about the second, and that was a way to lose a trip
 * for good: `days: [1, 2, 3]` passed, was written to storage, and then threw on
 * the next render, because `usage` walks `day.items`. There is no error
 * boundary anywhere in the app, so a throw during render is a blank page, and a
 * blank page has no Restore button on it to undo the restore that caused it.
 *
 * The rule is: refuse anything that would not survive a render. Everything
 * softer than that stays lenient, so a backup with no ledger still restores its
 * trip.
 */
export function parseBackup(text: string): { ok: true; backup: Backup } | { ok: false; message: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: 'That file is not readable as JSON.' };
  }
  if (!isObject(raw)) {
    return { ok: false, message: 'That file does not hold a backup.' };
  }
  if (raw.format !== 'itinerary-builder/backup') {
    return {
      ok: false,
      message: 'That file was not written by this app, so restoring it could not be undone safely.',
    };
  }
  if (typeof raw.version !== 'number') {
    return { ok: false, message: 'That file does not say which version of the app wrote it.' };
  }
  if (raw.version > BACKUP_VERSION) {
    return {
      ok: false,
      message: `That backup was written by a newer version of the app (${raw.version}).`,
    };
  }

  if (raw.itinerary !== undefined) {
    // Not `!== undefined && !Array.isArray(x.days)`: null is not undefined, so
    // that read .days off null and threw inside the parser meant to prevent it.
    if (!isObject(raw.itinerary)) {
      return { ok: false, message: 'The trip in that backup is not a trip.' };
    }
    const days = raw.itinerary.days;
    if (!Array.isArray(days)) {
      return { ok: false, message: 'The trip in that backup is missing its days.' };
    }
    // Every day is walked on render. One that is not a day with an items array
    // is what turns a restore into a permanently blank page.
    const badDay = days.findIndex((d) => !isObject(d) || !Array.isArray(d.items));
    if (badDay !== -1) {
      return {
        ok: false,
        message: `Day ${badDay + 1} in that backup is damaged, so restoring it would break the trip.`,
      };
    }
    const badItem = days.some((d) =>
      ((d as { items: unknown[] }).items).some((i) => !isObject(i)),
    );
    if (badItem) {
      return { ok: false, message: 'A stop in that backup is damaged.' };
    }
  }

  if (raw.expenses !== undefined) {
    if (!Array.isArray(raw.expenses) || raw.expenses.some((e) => !isObject(e))) {
      return { ok: false, message: 'The expenses in that backup are damaged.' };
    }
  }
  if (raw.userPlaces !== undefined) {
    if (!Array.isArray(raw.userPlaces) || raw.userPlaces.some((p) => !isObject(p))) {
      return { ok: false, message: 'The places in that backup are damaged.' };
    }
  }
  return { ok: true, backup: raw as unknown as Backup };
}

/**
 * Replace what is in storage with what is in the file.
 *
 * Writes straight to IndexedDB rather than through the reducers, and the caller
 * reloads afterwards. Going through the hooks would mean every write-through
 * effect racing this one.
 *
 * One `setMany`, not four `set` calls, and that is the whole point: setMany is
 * a single IndexedDB transaction, so either every section lands or none does.
 * Four separate writes could fail on the second, leaving the trip from the file
 * beside the ledger from before with nothing to say so, and the failure message
 * claiming nothing had changed.
 *
 * A section the file does not carry is left alone rather than cleared: a backup
 * taken before the ledger existed should not empty it. A section it carries as
 * an empty list is written, because that is a real ledger with nothing in it.
 */
export async function writeBackup(backup: Backup): Promise<void> {
  const entries: [string, unknown][] = [];
  if (backup.itinerary !== undefined) entries.push([TRIP_KEY, backup.itinerary]);
  if (backup.expenses !== undefined) entries.push([EXPENSES_KEY, backup.expenses]);
  if (typeof backup.rate === 'number' && backup.rate > 0) entries.push([RATE_KEY, backup.rate]);
  if (backup.userPlaces !== undefined) entries.push([PLACES_KEY, backup.userPlaces]);
  if (!entries.length) return;
  await setMany(entries);
}

/**
 * Land a trip opened from elsewhere, with its ledger, in one transaction.
 *
 * setMany rather than two writes for the same reason a restore uses it: either
 * both halves arrive or neither does, so a trip can never end up beside
 * somebody else's expenses.
 */
export async function writeOpenedTrip(itinerary: Itinerary, expenses: Expense[]): Promise<void> {
  await setMany([
    [TRIP_KEY, itinerary],
    [EXPENSES_KEY, expenses],
  ]);
}

/** "hangzhou-trip-backup-2026-09-05.json" */
export function backupFilename(name?: string): string {
  const stem = (name ?? 'trip')
    .replace(/[^-\w一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${stem || 'trip'}-backup-${new Date().toISOString().slice(0, 10)}.json`;
}
