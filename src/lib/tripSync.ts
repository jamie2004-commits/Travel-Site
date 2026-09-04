import { useCallback, useEffect, useRef, useState } from 'react';
import type { Itinerary } from '../types';
import type { Action } from './store';
import { supabase } from './supabase';
import { ensureIdentity } from './identity';
import { canonical, readSyncMeta, writeSyncMeta } from './syncMeta';

/**
 * Keeping the trip on the server in step with the trip on screen.
 *
 * The shape, because everything below follows from it:
 *
 *   IndexedDB is the write path of record. Postgres is a replica.
 *
 * The app runs with no Supabase configuration at all and has to work on a
 * plane, so the local store is the ordinary path and the server is an addition.
 * Every edit reaches IndexedDB immediately; this layer watches what lands there
 * and pushes it up. A failure never blocks, reverts or discards an edit.
 *
 * Two rules earned the hard way, both of which this got wrong first time:
 *
 *   1. Never push a document this browser did not load. `storage === 'ready'`
 *      is NOT sufficient: it goes true at the same moment `needsStart` does, so
 *      a first visit has a ready store and an empty reducer.
 *   2. Never push without knowing what the server had when this browser last
 *      agreed with it. Re-deriving the version on load makes a stale device
 *      look current, and it then overwrites a newer trip with no conflict.
 */

const DEBOUNCE_MS = 2500;
const MAX_WAIT_MS = 10000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
/** Stop retrying a failure that is clearly not going to fix itself. */
const MAX_ATTEMPTS = 12;

export type SyncStatus = 'off' | 'reading' | 'idle' | 'saving' | 'offline' | 'conflict' | 'error';

export interface Conflict {
  theirs: Itinerary;
  version: number;
  savedAt: string;
}

export interface SyncState {
  status: SyncStatus;
  message?: string;
  conflict: Conflict | null;
  lastSavedAt: string | null;
  keepTheirs: () => void;
  keepMine: () => void;
  retry: () => void;
}

const off: SyncState = {
  status: 'off',
  conflict: null,
  lastSavedAt: null,
  keepTheirs: () => {},
  keepMine: () => {},
  retry: () => {},
};

export function useTripSync(
  itinerary: Itinerary,
  dispatch: React.Dispatch<Action>,
  enabled: boolean,
): SyncState {
  const [status, setStatus] = useState<SyncStatus>('off');
  const [message, setMessage] = useState<string | undefined>();
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const latest = useRef(itinerary);
  const base = useRef<number | null>(null);
  const rowId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  /** Every pending backoff, so unmount can clear them and retry can coalesce. */
  const backoffs = useRef<number[]>([]);
  const firstEdit = useRef<number | undefined>(undefined);
  const attempt = useRef(0);
  const ready = useRef(false);
  const paused = useRef(false);
  /** The conflict, readable from callbacks without going through state. */
  const held = useRef<Conflict | null>(null);
  const mounted = useRef(true);

  const clearBackoffs = () => {
    for (const id of backoffs.current) window.clearTimeout(id);
    backoffs.current = [];
  };

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      backoffs.current = backoffs.current.filter((x) => x !== id);
      fn();
    }, ms);
    backoffs.current.push(id);
  };

  // ------------------------------------------------------------ first read
  const openRead = useCallback(async () => {
    const identity = await ensureIdentity();
    if (!mounted.current) return;
    if (identity.kind !== 'cloud' || !supabase) {
      setStatus('off');
      return;
    }
    setStatus('reading');

    const [{ data, error }, meta] = await Promise.all([
      supabase
        .from('itineraries')
        .select('id, doc, version, updated_at')
        .eq('is_active', true)
        .maybeSingle(),
      readSyncMeta(),
    ]);
    if (!mounted.current) return;

    if (error) {
      // Cannot tell whether the server has a trip, so writing now could
      // overwrite one. Stay quiet, keep working locally, and leave `ready`
      // false so nothing can push. Retry is what un-sticks this, and it has to
      // re-run the read rather than jumping to push.
      setStatus('offline');
      setMessage(error.code === '42P01' ? 'Trip sync is not set up on this project.' : undefined);
      return;
    }

    const localDoc = latest.current;

    if (!data) {
      // Nothing on the server: this browser's copy is the only one, so send it.
      base.current = 0;
      rowId.current = null;
      ready.current = true;
      setStatus('idle');
      if (canonical(localDoc) !== canonical(meta?.doc ?? null)) schedule();
      return;
    }

    rowId.current = data.id as string;
    const theirs = data.doc as unknown as Itinerary;
    const theirVersion = (data.version as number) ?? 1;
    setLastSavedAt((data.updated_at as string) ?? null);

    const sameAsServer = canonical(localDoc) === canonical(theirs);
    if (sameAsServer) {
      // In step. Take the number and say nothing.
      base.current = theirVersion;
      ready.current = true;
      setStatus('idle');
      void writeSyncMeta({ version: theirVersion, doc: theirs, savedAt: new Date().toISOString() });
      return;
    }

    // The documents differ. Whether that is safe to resolve depends entirely on
    // whether this browser has unpushed edits, which is what the meta records.
    const dirty = !meta || canonical(localDoc) !== canonical(meta.doc ?? null);
    const serverMoved = !meta || theirVersion !== meta.version;

    if (!dirty && serverMoved) {
      // Nothing local to lose: fast forward silently.
      base.current = theirVersion;
      ready.current = true;
      dispatch({ type: 'adopt', itinerary: theirs, label: 'Updated from another device' });
      void writeSyncMeta({ version: theirVersion, doc: theirs, savedAt: new Date().toISOString() });
      setStatus('idle');
      return;
    }

    if (dirty && !serverMoved) {
      // This browser is ahead and nobody else has written. Push.
      base.current = theirVersion;
      ready.current = true;
      setStatus('idle');
      schedule();
      return;
    }

    // Both moved, or this browser has never synced and the server already has
    // something. Either way a side would be lost by choosing without asking.
    base.current = theirVersion;
    ready.current = true;
    paused.current = true;
    held.current = { theirs, version: theirVersion, savedAt: (data.updated_at as string) ?? '' };
    setConflict(held.current);
    setStatus('conflict');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) return;
    void openRead();
    return () => {
      mounted.current = false;
    };
  }, [enabled, openRead]);

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
    if (base.current === null) return;
    if (inFlight.current) return;

    inFlight.current = true;
    window.clearTimeout(timer.current);
    firstEdit.current = undefined;
    setStatus('saving');

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
              // The compare and swap. Another device having written first comes
              // back as a 200 with an empty body, not an error, so the check
              // below is on the data and never on `error`.
              .eq('version', expected)
              .select('id, version, updated_at')
              .maybeSingle();

      inFlight.current = false;
      if (!mounted.current) return;

      if (result.error) {
        if (result.error.code === '23505') {
          await detectConflict();
          return;
        }
        fail(result.error.code === '42P01' ? 'Trip sync is not set up on this project.' : undefined);
        return;
      }

      if (!result.data) {
        await detectConflict();
        return;
      }

      attempt.current = 0;
      rowId.current = result.data.id as string;
      base.current = (result.data.version as number) ?? expected + 1;
      const savedAt = (result.data.updated_at as string) ?? new Date().toISOString();
      setLastSavedAt(savedAt);
      void writeSyncMeta({ version: base.current, doc, savedAt });

      // Identity, not a flag: an edit may have landed mid-flight, in which case
      // the server does not have the newest document.
      if (latest.current !== doc) {
        setStatus('saving');
        schedule();
      } else {
        setStatus('idle');
        setMessage(undefined);
      }
    } catch (cause) {
      inFlight.current = false;
      if (!mounted.current) return;
      console.warn('Could not save the trip to the server.', cause);
      fail(undefined);
    }
  }

  function fail(why: string | undefined) {
    attempt.current += 1;
    setMessage(why);
    if (attempt.current >= MAX_ATTEMPTS) {
      // Retrying a refusal forever is battery and log noise. Stop, and leave a
      // button, rather than pretending something is still happening.
      setStatus('error');
      return;
    }
    setStatus('offline');
    later(() => void push(), BACKOFF_MS[Math.min(attempt.current - 1, BACKOFF_MS.length - 1)]);
  }

  async function detectConflict(): Promise<void> {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('itineraries')
      .select('id, doc, version, updated_at')
      .eq('is_active', true)
      .maybeSingle();
    if (!mounted.current) return;

    if (error) {
      // A failed read here used to be read as "the server has no trip", which
      // reset base to 0 and set the status to idle: a network blip presented as
      // everything being fine while sync was broken and about to insert a
      // duplicate. It is just a failure.
      fail(undefined);
      return;
    }
    if (!data) {
      base.current = 0;
      rowId.current = null;
      setStatus('idle');
      return;
    }

    rowId.current = data.id as string;
    const theirs = data.doc as unknown as Itinerary;
    const theirVersion = (data.version as number) ?? 1;

    // Same content, different number. Nothing to decide.
    if (canonical(theirs) === canonical(latest.current)) {
      base.current = theirVersion;
      setLastSavedAt((data.updated_at as string) ?? null);
      void writeSyncMeta({
        version: theirVersion,
        doc: theirs,
        savedAt: (data.updated_at as string) ?? new Date().toISOString(),
      });
      setStatus('idle');
      return;
    }

    paused.current = true;
    held.current = { theirs, version: theirVersion, savedAt: (data.updated_at as string) ?? '' };
    setConflict(held.current);
    setStatus('conflict');
  }

  // Side effects outside the state updater. StrictMode invokes an updater
  // twice, which dispatched `adopt` twice and left the undo stack holding the
  // adopted copy on top, so one press of undo appeared to do nothing.
  const keepTheirs = useCallback(() => {
    const c = held.current;
    if (!c) return;
    held.current = null;
    setConflict(null);
    dispatch({ type: 'adopt', itinerary: c.theirs, label: 'Took the other device' });
    base.current = c.version;
    void writeSyncMeta({ version: c.version, doc: c.theirs, savedAt: c.savedAt });
    paused.current = false;
    setStatus('idle');
  }, [dispatch]);

  const keepMine = useCallback(() => {
    const c = held.current;
    if (!c) return;
    held.current = null;
    setConflict(null);
    // Re-based onto what the server has now, so the next write is a deliberate
    // overwrite rather than another conflict.
    base.current = c.version;
    paused.current = false;
    attempt.current = 0;
    setStatus('saving');
    void push();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = useCallback(() => {
    attempt.current = 0;
    clearBackoffs();
    // A first read that failed leaves `ready` false, and push() would return
    // immediately, so the button would do nothing at all. Re-run the read.
    if (!ready.current) {
      void openRead();
      return;
    }
    void push();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRead]);

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
      // Untracked backoff timers used to outlive the component and land a write
      // after the user had navigated away.
      clearBackoffs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled) return off;
  return { status, message, conflict, lastSavedAt, keepTheirs, keepMine, retry };
}
