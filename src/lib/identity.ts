import { supabase } from './supabase';

/**
 * Who this browser is, as far as the database is concerned.
 *
 * There is no sign in screen. Supabase anonymous sign ins mint a real
 * `auth.users` row and a real JWT on first load, which is what `auth.uid()`
 * needs and therefore what every row level security policy is written against.
 * The alternative was opening the tables to the `anon` role, and the anon key
 * ships inside the bundle, so that is an open write endpoint on the public
 * internet. This gets owner scoping with none of that and no login.
 *
 * It also keeps the door open: adding email sign in later upgrades the same
 * `auth.users` row, so nothing has to be migrated when it arrives.
 */

export type Identity =
  | { kind: 'cloud'; userId: string; anonymous: boolean }
  | { kind: 'local'; reason: 'not-configured' | 'unreachable' | 'refused' };

/**
 * Locked so two tabs opening at once cannot each mint an account.
 *
 * Both would see no session, both would call signInAnonymously, both would
 * write the shared auth token, and the loser's `auth.users` row would be
 * orphaned with nothing able to reach it again. React StrictMode makes the
 * same race happen inside one tab, twice per mount, which is why this is a
 * module level promise rather than an effect.
 */
const LOCK = 'itinerary-builder/identity';

let bootstrap: Promise<Identity> | null = null;

export function ensureIdentity(): Promise<Identity> {
  if (!bootstrap) bootstrap = run();
  return bootstrap;
}

/** Forget the cached answer, so the next call tries again. For retries. */
export function resetIdentity(): void {
  bootstrap = null;
}

async function run(): Promise<Identity> {
  // The normal state of a local checkout: no env vars, no client, and the app
  // works entirely off the bundled catalog and this browser's storage.
  if (!supabase) return { kind: 'local', reason: 'not-configured' };

  try {
    // getSession internally awaits the client's own initialisation, so calling
    // it first is what keeps this from racing the token parsing that happens
    // when a session is being restored.
    const existing = await supabase.auth.getSession();
    if (existing.data.session) return fromUser(existing.data.session.user);

    return await withLock(async () => {
      // Re-read inside the lock. Another tab may have signed in while this one
      // was waiting, and a second signInAnonymously would orphan the first.
      if (!supabase) return { kind: 'local', reason: 'not-configured' } as const;
      const again = await supabase.auth.getSession();
      if (again.data.session) return fromUser(again.data.session.user);

      const { data, error } = await supabase.auth.signInAnonymously();
      if (error || !data.user) {
        // Anonymous sign ins are rate limited per IP, so a shared office or
        // cafe network can refuse a perfectly ordinary visitor. Not an error
        // state: the app carries on locally, exactly as it did before any of
        // this existed.
        console.warn('Could not take an identity for this browser.', error?.message);
        return { kind: 'local', reason: 'refused' } as const;
      }
      return fromUser(data.user);
    });
  } catch (cause) {
    console.warn('Could not reach the server to take an identity.', cause);
    return { kind: 'local', reason: 'unreachable' };
  }
}

function fromUser(user: { id: string; is_anonymous?: boolean }): Identity {
  return { kind: 'cloud', userId: user.id, anonymous: user.is_anonymous ?? false };
}

/**
 * navigator.locks where it exists, which is everywhere current, and a plain
 * call where it does not. The fallback races; the consequence is a spare
 * `auth.users` row, not lost data.
 */
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return fn();
  return navigator.locks.request(LOCK, fn) as Promise<T>;
}

/** Whether writing to the server is possible at all in this build. */
export const cloudAvailable = Boolean(supabase);
