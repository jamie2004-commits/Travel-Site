import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * Sign in is by emailed link, not password. Supabase sends a one time link,
 * clicking it returns here with a session, and the client refreshes that
 * session from then on. Nothing to remember, and no password to store.
 *
 * Everything here no-ops when Supabase is not configured, so the app keeps
 * working off the bundled catalog with the sign in UI simply absent.
 */

export interface AuthState {
  /** Null when signed out, or when Supabase is not configured at all. */
  email: string | null;
  userId: string | null;
  /** True until the stored session has been read, so the UI can wait. */
  loading: boolean;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    email: null,
    userId: null,
    // Nothing to wait for when there is no client.
    loading: Boolean(supabase),
  });

  useEffect(() => {
    if (!supabase) return;
    let live = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!live) return;
      setState({
        email: data.session?.user.email ?? null,
        userId: data.session?.user.id ?? null,
        loading: false,
      });
    });

    // Fires on sign in, sign out, and on the token refresh that happens when
    // a stored session is still valid but stale.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!live) return;
      setState({
        email: session?.user.email ?? null,
        userId: session?.user.id ?? null,
        loading: false,
      });
    });

    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}

export interface SignInResult {
  ok: boolean;
  message: string;
}

export async function sendSignInLink(email: string): Promise<SignInResult> {
  if (!supabase) {
    return { ok: false, message: 'Supabase is not configured for this build.' };
  }

  const trimmed = email.trim();
  if (!trimmed) return { ok: false, message: 'Enter an email address.' };

  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      // Back to whatever page the link was requested from. The hash router
      // means this is a plain origin plus path, with no route to preserve.
      emailRedirectTo: window.location.origin,
    },
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, message: `Check ${trimmed} for a sign in link.` };
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

/** Whether writing to the catalog is possible at all in this build. */
export const authAvailable = Boolean(supabase);
