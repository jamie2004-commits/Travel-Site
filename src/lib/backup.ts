import { get, set } from 'idb-keyval';
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

const TRIP_KEY = 'itinerary-builder/v1';
const EXPENSES_KEY = 'itinerary-builder/expenses/v1';
const RATE_KEY = 'itinerary-builder/expenses/rate/v1';
const PLACES_KEY = 'itinerary-builder/user-places/v1';

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
  savedAt?: string;
  name?: string;
}

/** What a file holds, for a confirmation that names it before replacing anything. */
export function summarise(backup: Backup): BackupSummary {
  const days = backup.itinerary?.days ?? [];
  return {
    days: days.length,
    stops: days.reduce((n, d) => n + (d.items?.length ?? 0), 0),
    expenses: backup.expenses?.length ?? 0,
    places: backup.userPlaces?.length ?? 0,
    savedAt: backup.savedAt,
    name: backup.itinerary?.name,
  };
}

/**
 * Read a file back into a Backup, or explain why it is not one.
 *
 * Deliberately strict about the envelope and lenient about the contents. A file
 * that is not ours must be refused loudly, because restoring replaces a trip.
 * Beyond that, a backup missing its expenses is still worth restoring for the
 * trip, so absent sections are allowed and only wrong ones are rejected.
 */
export function parseBackup(text: string): { ok: true; backup: Backup } | { ok: false; message: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: 'That file is not readable as JSON.' };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: 'That file does not hold a backup.' };
  }
  const b = raw as Partial<Backup>;
  if (b.format !== 'itinerary-builder/backup') {
    return {
      ok: false,
      message: 'That file was not written by this app, so restoring it could not be undone safely.',
    };
  }
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    return {
      ok: false,
      message: `That backup was written by a newer version of the app (${String(b.version)}).`,
    };
  }
  if (b.itinerary !== undefined && !Array.isArray(b.itinerary.days)) {
    return { ok: false, message: 'The trip in that backup is missing its days.' };
  }
  if (b.expenses !== undefined && !Array.isArray(b.expenses)) {
    return { ok: false, message: 'The expenses in that backup are not a list.' };
  }
  if (b.userPlaces !== undefined && !Array.isArray(b.userPlaces)) {
    return { ok: false, message: 'The places in that backup are not a list.' };
  }
  return { ok: true, backup: b as Backup };
}

/**
 * Replace what is in storage with what is in the file.
 *
 * Writes straight to IndexedDB rather than through the reducers, and the caller
 * reloads afterwards. Going through the hooks would mean every write-through
 * effect racing this one, and a half applied restore is worse than a reload.
 *
 * A section the file does not carry is left alone rather than cleared: a backup
 * taken before the ledger existed should not empty it.
 */
export async function writeBackup(backup: Backup): Promise<void> {
  if (backup.itinerary) await set(TRIP_KEY, backup.itinerary);
  if (backup.expenses) await set(EXPENSES_KEY, backup.expenses);
  if (typeof backup.rate === 'number' && backup.rate > 0) await set(RATE_KEY, backup.rate);
  if (backup.userPlaces) await set(PLACES_KEY, backup.userPlaces);
}

/** "hangzhou-trip-backup-2026-09-05.json" */
export function backupFilename(name?: string): string {
  const stem = (name ?? 'trip')
    .replace(/[^-\w一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${stem || 'trip'}-backup-${new Date().toISOString().slice(0, 10)}.json`;
}
