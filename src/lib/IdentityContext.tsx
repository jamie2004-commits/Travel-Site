import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ensureIdentity, type Identity } from './identity';

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
  anonymous: boolean;
  /** False while the first call is in flight. */
  ready: boolean;
  /** Set when there is no server identity, and why. */
  reason?: string;
}

const IdentityContext = createContext<IdentityValue>({
  userId: null,
  anonymous: false,
  ready: false,
});

export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);

  useEffect(() => {
    let live = true;
    void ensureIdentity().then((result) => {
      if (live) setIdentity(result);
    });
    return () => {
      live = false;
    };
  }, []);

  const value = useMemo<IdentityValue>(() => {
    if (!identity) return { userId: null, anonymous: false, ready: false };
    if (identity.kind === 'local') {
      return { userId: null, anonymous: false, ready: true, reason: identity.reason };
    }
    return { userId: identity.userId, anonymous: identity.anonymous, ready: true };
  }, [identity]);

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity() {
  return useContext(IdentityContext);
}
