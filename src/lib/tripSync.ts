import { useCallback, useEffect, useRef, useState } from 'react';
import type { Itinerary } from '../types';
import type { Action } from './store';
import { supabase } from './supabase';
import { ensureIdentity } from './identity';

/**
 * Keeping the trip on the server in step with the trip on screen.
 *
 * The shape of the whole thing, because the details below only make sense
 * against it:
 *
 *   IndexedDB is the write path of record. Postgres is a replica.
 *
 * That is deliberate and not the obvious choice. The app runs with no Supabase
 * configuration at all, and it has to keep working on a plane, so the local
 * store is the normal path and the server is an addition to it. Making Postgres
 * the truth would turn the app's ordinary configuration into a special case of
 * a broken one.
 *
 * So: every edit goes to IndexedDB immediately and unconditionally, exactly as
 * it did before any of this. This layer watches what lands there and pushes it
 * up, debounced. A failure here never blocks, reverts, or discards an edit.
 */

/** How long a burst of typing collapses into one write. */
const DEBOUNCE_MS = 2500;
/** And the longest a continuous burst can defer one. */
const MAX_WAIT_MS = 10000;

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export type SyncStatus =
  /** No client, or no identity. The app is local only and says so. */
  | 'off'
  /** Reading the server copy for the first time. */
  | 'reading'
  /** In step. */
  | 'idle'
  | 'saving'
  /** Unreachable, with edits not yet pushed. */
  | 'offline'
  /** The server moved under us. Waiting on a decision. */
  | 'conflict'
  | 'error';

export interface Conflict {
  /** What the server holds now. */
  theirs: Itinerary;
  version: number;
  savedAt: string;
}

export interface SyncState {
  status: SyncStatus;
  message?: string;
  conflict: Conflict | null;
  lastSavedAt: string | null;
  /** Take the server's copy. The local one lands on the undo stack. */
  keepTheirs: () => void;
  /** Overwrite the server with what is on screen. */
  keepMine: () => void;
  retry: () => void;
}

const idle: SyncState = {
  status: 'off',
  conflict: null,
  lastSavedAt: null,
  keepTheirs: () => {},
  keepMine: () => {},
  retry: () => {},
};

/**
 * `enabled` is the gate that keeps this from ever writing before the local
 * store has been read. It is the caller's `storage === 'ready'`, and getting it
 * wrong is how an empty trip reaches the server.
 */
export function useTripSync(
  itinerary: Itinerary,
  dispatch: React.Dispatch<Action>,
  enabled: boolean,
): SyncState {
  const [status, setStatus] = useState<SyncStatus>('off');
  const [message, setMessage] = useState<string | undefined>();
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  /** The newest document, read by the timer and by the unload handler. */
  const latest = useRef(itinerary);
  /** The server version this document was derived from. Null means unknown. */
  const base = useRef<number | null>(null);
  const rowId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const firstEdit = useRef<number | undefined>(undefined);
  const attempt = useRef(0);
  /** True once the first read has settled. No write happens before this. */
  const ready = useRef(false);
  const paused = useRef(false);

  // ------------------------------------------------------------ first read
  useEffect(() => {
    if (!enabled) return;
    let live = true;

    void (async () => {
      const identity = await ensureIdentity();
      if (!live) return;
      if (identity.kind !== 'cloud' || !supabase) {
        setStatus('off');
        return;
      }
      setStatus('reading');
      const { data, error } = await supabase
        .from('itineraries')
        .select('id, doc, version, updated_at')
        .eq('is_active', true)
        .maybeSingle();
      if (!live) return;

      if (error) {
        // Cannot tell whether the server has a trip, so writing now could
        // overwrite one. Stay quiet and keep working locally.
        setStatus('offline');
        setMessage(error.code === '42P01' ? 'Trip sync is not set up on this project.' : undefined);
        return;
      }

      if (data) {
        rowId.current = data.id as string;
        base.current = (data.version as number) ?? 1;
        setLastSavedAt((data.updated_at as string) ?? null);
      } else {
        // Nothing on the server. base 0 means "insert", which the partial
        // unique index turns into a conflict if another device got there first.
        base.current = 0;
      }
      ready.current = true;
      setStatus('idle');
      // Anything edited before the read settled still needs pushing.
      schedule();
    })();

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ------------------------------------------------------- watch for edits
  useEffect(() => {
    latest.current = itinerary;
    if (!enabled || !ready.current || paused.current) return;
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itinerary, enabled]);

  function schedule() {
    if (firstEdit.current === undefined) firstEdit.current = Date.now();
    const waited = Date.now() - firstEdit.current;
    const delay = Math.min(DEBOUNCE_MS, Math.max(0, MAX_WAIT_MS - waited));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void push(), delay);
  }

  async function push(): Promise<void> {
    if (!supabase || !ready.current || paused.current) return;
    if (base.current === null) return; // unknown base: never guess
    if (inFlight.current) return;

    inFlight.current = true;
    window.clearTimeout(timer.current);
    firstEdit.current = undefined;
    setStatus('saving');

    // Compared by identity below, to notice an edit that landed mid-flight.
    const doc = latest.current;
    const expected = base.current;

    try {
      const row = {
        doc: doc as unknown as Record<string, unknown>,
        client_updated_at: new Date().toISOString(),
      };

      const result =
        expected === 0 || !rowId.current
          ? await supabase
              .from('itineraries')
              .insert({ ...row, is_active: true })
              .select('id, version, updated_at')
              .maybeSingle()
          : await supabase
              .from('itineraries')
              .update(row)
              .eq('id', rowId.current)
              // The compare and swap. Zero rows back means another device
              // wrote first, which arrives as a 200 with an empty body rather
              // than an error, so the check below is on the data and not on
              // `error`.
              .eq('version', expected)
              .select('id, version, updated_at')
              .maybeSingle();

      inFlight.current = false;

      if (result.error) {
        // 23505 on the active-trip index means another device claimed the slot
        // between our read and our insert. That is a conflict, not a failure.
        if (result.error.code === '23505') {
          await detectConflict();
          return;
        }
        attempt.current += 1;
        setStatus('offline');
        setMessage(result.error.code === '42P01' ? 'Trip sync is not set up on this project.' : undefined);
        const wait = BACKOFF_MS[Math.min(attempt.current - 1, BACKOFF_MS.length - 1)];
        window.setTimeout(() => void push(), wait);
        return;
      }

      if (!result.data) {
        await detectConflict();
        return;
      }

      attempt.current = 0;
      rowId.current = result.data.id as string;
      base.current = (result.data.version as number) ?? expected + 1;
      setLastSavedAt((result.data.updated_at as string) ?? null);

      // Identity, not a flag. An edit may have landed while the request was in
      // flight, in which case the server does not have the newest document.
      if (latest.current !== doc) {
        setStatus('saving');
        schedule();
      } else {
        setStatus('idle');
        setMessage(undefined);
      }
    } catch (cause) {
      inFlight.current = false;
      attempt.current += 1;
      console.warn('Could not save the trip to the server.', cause);
      setStatus('offline');
      const wait = BACKOFF_MS[Math.min(attempt.current - 1, BACKOFF_MS.length - 1)];
      window.setTimeout(() => void push(), wait);
    }
  }

  /** Read what the server actually holds, so the user can be shown both. */
  async function detectConflict(): Promise<void> {
    if (!supabase) return;
    const { data } = await supabase
      .from('itineraries')
      .select('id, doc, version, updated_at')
      .eq('is_active', true)
      .maybeSingle();
    if (!data) {
      // It went away entirely. Next push inserts.
      base.current = 0;
      rowId.current = null;
      setStatus('idle');
      return;
    }
    rowId.current = data.id as string;

    const theirs = data.doc as unknown as Itinerary;
    // Same content, different version. Nothing to decide: take the number and
    // say nothing. This is the common case when two tabs both save.
    if (JSON.stringify(theirs) === JSON.stringify(latest.current)) {
      base.current = (data.version as number) ?? null;
      setLastSavedAt((data.updated_at as string) ?? null);
      setStatus('idle');
      return;
    }

    paused.current = true;
    setConflict({
      theirs,
      version: (data.version as number) ?? 1,
      savedAt: (data.updated_at as string) ?? '',
    });
    setStatus('conflict');
  }

  const keepTheirs = useCallback(() => {
    setConflict((c) => {
      if (c) {
        // Onto the undo stack rather than gone, so one press brings back what
        // was on screen. That is the whole reason `adopt` exists.
        dispatch({ type: 'adopt', itinerary: c.theirs, label: 'Took the other device' });
        base.current = c.version;
      }
      paused.current = false;
      setStatus('idle');
      return null;
    });
  }, [dispatch]);

  const keepMine = useCallback(() => {
    setConflict((c) => {
      // Re-base onto what the server has now, so the next write is a deliberate
      // overwrite rather than another conflict.
      if (c) base.current = c.version;
      paused.current = false;
      setStatus('saving');
      window.setTimeout(() => void push(), 0);
      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = useCallback(() => {
    attempt.current = 0;
    void push();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------- flush on leaving, and online
  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      if (ready.current && !paused.current && !inFlight.current) void push();
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('online', flush);
    window.addEventListener('blur', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('online', flush);
      window.removeEventListener('blur', flush);
      window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled) return idle;
  return { status, message, conflict, lastSavedAt, keepTheirs, keepMine, retry };
}
