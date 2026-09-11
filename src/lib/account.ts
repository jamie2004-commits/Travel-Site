import { supabase } from './supabase';
import { ensureIdentity, resetIdentity } from './identity';

/**
 * Putting an email on the browser's identity, so two devices are one person.
 *
 * Everything here exists to replace the trip code. `identity.ts` mints an
 * anonymous `auth.users` row per browser, which is a real identity that row
 * level security can scope to, and is also the reason a trip was invisible on
 * a second device: two browsers, two anonymous people, and no query that could
 * ever bridge them. The code bridged it by making a uuid the permission.
 *
 * An email bridges it by making the two browsers the same row instead. Once
 * that is true, every owner-scoped policy already written in 0006 and 0010
 * returns the right trips on both devices, nothing needs a `security definer`
 * function, and there is no secret that cannot be unlearned.
 *
 * ------------------------------------------------------------------------
 *
 * There are two ways in, and picking the wrong one loses a trip, so they are
 * separate calls with separate names rather than one clever function.
 *
 *   `claim` is for the device that already has the trips. The session is
 *   anonymous, it owns rows, and `updateUser({ email })` upgrades that same
 *   `auth.users` row in place. The user id does not change, so every trip,
 *   expense and checklist row stays exactly where it is and nothing is
 *   migrated. `identity.ts` predicted this: "adding email sign in later
 *   upgrades the same auth.users row".
 *
 *   `signIn` is for every other device. It abandons that browser's anonymous
 *   identity and takes on the account's, which is what makes the trips appear.
 *   Anything that anonymous identity owned becomes unreachable, which is
 *   correct on a device that only ever held a copy, and is why the caller has
 *   to make sure that is true before calling this.
 *
 * Both finish through `confirm`, because both send a six digit code to the
 * address and neither is complete until it comes back. The `type` differs and
 * that is the whole reason confirm takes a mode: 'email_change' finishes an
 * upgrade, 'email' finishes a sign in, and using one for the other fails in a
 * way whose message explains nothing.
 */

export type AccountMode = 'claim' | 'signIn';

export type AccountResult =
  | { ok: true }
  | { ok: false; message: string };

/** Somewhere to fail to, when there is no server in this build at all. */
const noServer: AccountResult = {
  ok: false,
  message: 'This build is not connected to a database, so there are no accounts.',
};

/**
 * Ask for a code, on the device whose trips these are.
 *
 * Requires an anonymous session to upgrade, and says so plainly rather than
 * silently doing nothing: called on a device already signed in, this would
 * change the account's email address, which is a different act with a
 * different blast radius.
 */
export async function claim(email: string): Promise<AccountResult> {
  if (!supabase) return noServer;
  const identity = await ensureIdentity();
  if (identity.kind !== 'cloud') {
    return { ok: false, message: 'Not connected to the database, so there is no identity to name.' };
  }
  if (!identity.anonymous) {
    return { ok: false, message: 'This device is already signed in.' };
  }

  const { error } = await supabase.auth.updateUser({ email: email.trim() });
  if (error) return { ok: false, message: readable(error.message) };
  return { ok: true };
}

/**
 * Ask for a code, on a device that is joining an account that already exists.
 *
 * `shouldCreateUser: false` because this path is only ever reached by someone
 * saying they already have an account. Left at its default it would silently
 * mint a brand new empty one for a mistyped address, and the failure would
 * arrive as "your trips are gone" rather than "no such account".
 */
export async function signIn(email: string): Promise<AccountResult> {
  if (!supabase) return noServer;
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: false },
  });
  if (error) return { ok: false, message: readable(error.message) };
  return { ok: true };
}

/**
 * Finish either flow with the code from the email.
 *
 * `resetIdentity()` on the way out because `ensureIdentity` caches its answer
 * in a module level promise, and every caller downstream -- the sync layer, the
 * catalog's writes, the trip list -- would otherwise keep asking the cache and
 * get the identity from before the sign in for the rest of the session.
 */
export async function confirm(
  email: string,
  token: string,
  mode: AccountMode,
): Promise<AccountResult> {
  if (!supabase) return noServer;
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: mode === 'claim' ? 'email_change' : 'email',
  });
  if (error) return { ok: false, message: readable(error.message) };
  resetIdentity();
  return { ok: true };
}

/**
 * Leave the account on this device.
 *
 * Deliberately does NOT clear the trip stored here. Signing out is about who
 * the database thinks you are, and someone who signs out on a shared laptop
 * has said nothing about wanting the trip deleted from it. The caller decides
 * what to do with local data, and has more context than this does.
 */
export async function signOut(): Promise<AccountResult> {
  if (!supabase) return noServer;
  const { error } = await supabase.auth.signOut();
  if (error) return { ok: false, message: readable(error.message) };
  resetIdentity();
  return { ok: true };
}

/**
 * Supabase's auth errors are written for developers. These four are the ones a
 * person actually hits, and left raw each of them reads like a bug in the app
 * rather than something they can act on.
 */
function readable(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('already been registered') || m.includes('already registered')) {
    return 'That address already has an account. Use "I already have an account" instead, and this device will join it.';
  }
  if (m.includes('signups not allowed') || m.includes('user not found')) {
    return 'No account for that address yet. Check the spelling, or set one up on the device that has your trips.';
  }
  if (m.includes('token has expired') || m.includes('expired')) {
    return 'That code has expired. Ask for a new one.';
  }
  if (m.includes('invalid') && m.includes('token')) {
    return (
      'That code was not accepted. Check the newest email, since asking again replaces the ' +
      'old code. If the email had a link in it and no six digit code at all, the email ' +
      'templates on this project still need {{ .Token }} adding: see "Email sign in" in README.md.'
    );
  }
  /*
   * The built-in email service is two messages an hour for the whole project,
   * and this app needs exactly two to set itself up: one to claim the account
   * on the first device, one to sign in on the second. So a couple of retries
   * is all it takes to be locked out of finishing, and the raw message does not
   * hint at an hour of waiting.
   */
  if (m.includes('rate limit') || m.includes('too many') || m.includes('over_email_send')) {
    return (
      'The email service is rate limited: the built-in one sends two messages an hour for ' +
      'the whole project. Wait an hour and try once, or set up custom SMTP to remove the cap. ' +
      'See "Email sign in" in README.md.'
    );
  }

  /*
   * Distinct from the cap above, and the difference matters because waiting
   * does not fix this one: without custom SMTP, Supabase refuses to deliver to
   * any address that is not on the project's team.
   */
  if (m.includes('not authorized') || m.includes('not allowed for this')) {
    return (
      'That address is not on this Supabase project team, and the built-in email service ' +
      'only delivers to addresses that are. Use the address your Supabase account uses, or ' +
      'set up custom SMTP.'
    );
  }

  if (m.includes('error sending')) {
    return (
      'The email could not be sent. Almost always the two-an-hour cap on the built-in email ' +
      'service, or an address that is not on this Supabase project team. Both are covered ' +
      'under "Email sign in" in README.md.'
    );
  }
  return message || 'Could not finish that. Try again.';
}
