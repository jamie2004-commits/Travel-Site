import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ensureIdentity, resetIdentity, type Identity } from './identity';
import { supabase } from './supabase';

/**
 * Who this browser is, made available to the tree.
 *
 * One provider rather than a hook per component, because `ensureIdentity` is a
 * module level singleton and several places need the same answer at the same
 * moment: the library to decide whether to draw a delete control, the writes to
 * stamp `created_by`, and the sync layer to know whether there is anywhere to
 * sync to. Calling it separately would work, but they would resolve at
 * different times and briefly disagree.
 */

interface IdentityValue {
  /** Null until it resolves, and null forever in a local-only build. */
  userId: string | null;
  /** True for the identity every browser starts with, before any email is on it. */
  anonymous: boolean;
  /** The address this account signs in with, once there is one. */
  email: string | null;
  /** False while the first call is in flight. */
  ready: boolean;
  /** Set when there is no server identity, and why. */
  reason?: string;
}

const IdentityContext = createContext<IdentityValue>({
  userId: null,
  anonymous: false,
  email: null,
  ready: false,
});

export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);

  useEffect(() => {
    let live = true;
    void ensureIdentity().then((result) => {
      if (live) setIdentity(result);
    });

    /**
     * Signing in replaces the session underneath everything, and without this
     * the tree keeps rendering the identity from before it. `ensureIdentity`
     * caches in a module level promise, so the cache has to be dropped before
     * re-asking or it hands back the same stale answer it just gave.
     *
     * The sign in flow reloads the page anyway, for reasons the trip layer
     * cares about. This is what keeps the header honest in the moment between,
     * and what covers a session ending on its own -- an expired token, or a
     * sign out in another tab -- which no reload is coming for.
     */
    const listener = supabase?.auth.onAuthStateChange(() => {
      if (!live) return;
      resetIdentity();
      void ensureIdentity().then((result) => {
        if (live) setIdentity(result);
      });
    });

    return () => {
      live = false;
      listener?.data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<IdentityValue>(() => {
    if (!identity) return { userId: null, anonymous: false, email: null, ready: false };
    if (identity.kind === 'local') {
      return { userId: null, anonymous: false, email: null, ready: true, reason: identity.reason };
    }
    return {
      userId: identity.userId,
      anonymous: identity.anonymous,
      email: identity.email,
      ready: true,
    };
  }, [identity]);

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity() {
  return useContext(IdentityContext);
}
