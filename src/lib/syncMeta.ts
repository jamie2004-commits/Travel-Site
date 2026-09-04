import { get, set } from 'idb-keyval';
import type { Itinerary } from '../types';

/**
 * What this browser last agreed with the server about.
 *
 * Without this, `base` is re-derived from the server on every page load, so a
 * device always claims to be current and a compare-and-swap can only catch a
 * write that lands between this device's own read and its own write. The
 * ordinary two-device case, where one device has been away and the other has
 * moved on, looks identical to being up to date, and the stale copy wins.
 *
 * Remembering the version this browser last synced, and the document it synced,
 * is what turns "the server is ahead of what I last saw" into something
 * detectable rather than invisible.
 */

const KEY = 'itinerary-builder/sync-meta/v1';

export interface SyncMeta {
  /** The server version this browser last wrote or read successfully. */
  version: number;
  /** The document at that version, to tell an unpushed edit from none. */
  doc: Itinerary | null;
  savedAt: string;
}

export async function readSyncMeta(): Promise<SyncMeta | null> {
  try {
    const stored = await get<SyncMeta>(KEY);
    if (!stored || typeof stored.version !== 'number') return null;
    return stored;
  } catch {
    // Unreadable meta is the same as none: fall back to asking rather than
    // guessing, which is what a null return makes the caller do.
    return null;
  }
}

export async function writeSyncMeta(meta: SyncMeta): Promise<void> {
  try {
    await set(KEY, meta);
  } catch (cause) {
    console.warn('Could not remember what was last synced.', cause);
  }
}

/**
 * A stable string for comparing two documents.
 *
 * `JSON.stringify` will not do. The document round trips through Postgres
 * `jsonb`, which sorts object keys and drops nothing else, so a document that
 * went up as `{name, days}` comes back as `{days, name}` and a plain stringify
 * compares unequal every single time. That made the "identical, say nothing"
 * suppression dead code and turned every second save into a conflict prompt
 * about two copies that matched.
 *
 * Undefined-valued keys are dropped rather than kept, for the same reason: they
 * do not survive the trip either.
 */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}
