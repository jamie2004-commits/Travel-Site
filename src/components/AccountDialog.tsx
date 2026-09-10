import { useEffect, useRef, useState } from 'react';
import { claim, signIn, confirm, signOut, type AccountMode } from '../lib/account';
import { forgetOpenTripId } from '../lib/openTrip';
import { useIdentity } from '../lib/IdentityContext';

interface Props {
  onClose: () => void;
}

/**
 * Putting an email on this browser, which is what makes two devices one person.
 *
 * This dialog replaced the trip code, and the difference worth keeping in mind
 * while reading it is that a code was a thing you *carried* and an account is a
 * thing you *are*. The code had to be copied from one machine and pasted into
 * another every time a new device appeared; it granted whoever held it full
 * edit rights forever, with no way to take that back. An address grants nothing
 * to anyone who cannot read the inbox.
 *
 * Two ways in, kept visibly separate because choosing wrong is not cosmetic.
 * `claim` upgrades this browser's anonymous identity in place, so every trip it
 * owns stays owned; `signIn` abandons this browser's identity for an account
 * that already exists, which is right on a device holding a copy and wrong on
 * the one holding the originals. The dialog leads with whichever fits what it
 * can see, and never hides the other.
 */
export default function AccountDialog({ onClose }: Props) {
  const { anonymous, email: signedInAs, ready, reason } = useIdentity();

  /** Which flow, decided by the button pressed rather than inferred. */
  const [mode, setMode] = useState<AccountMode>('claim');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  /** Set once a code has been sent, which is what swaps the form over. */
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function ask(which: AccountMode) {
    if (busy || !email.trim()) return;
    setMode(which);
    setBusy(true);
    setError(null);
    const result = which === 'claim' ? await claim(email) : await signIn(email);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSent(true);
    setNote(`A six digit code is on its way to ${email.trim()}.`);
  }

  async function finish() {
    if (busy || !token.trim()) return;
    setBusy(true);
    setError(null);
    const result = await confirm(email, token, mode);
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }

    /*
     * Signing in replaced this browser's identity, so the trip it was pointing
     * at belongs to the identity it just left and the pointer is meaningless.
     * Dropped rather than followed: the next load finds no trip, asks the
     * account what it owns, and adopts the single answer or offers the list.
     *
     * Not done for a claim. There the identity is the same row with an address
     * on it now, every trip is still owned, and the pointer is still correct.
     */
    if (mode === 'signIn') await forgetOpenTripId();

    // A reload rather than re-rendering into the new identity. Every layer
    // below caches who it is asking as -- the sync loop, the catalog's writes,
    // the trip list -- and starting them fresh is far cheaper to reason about
    // than teaching each one to be re-pointed mid-flight.
    window.location.reload();
  }

  const already = ready && !anonymous && signedInAs;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: 'rgba(18,33,31,.5)' }}
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Your account"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md border p-5"
        style={{ background: 'var(--card)', borderColor: 'var(--line)', borderRadius: 2 }}
      >
        <p className="eyebrow">Account</p>

        {already ? (
          <>
            <h2 className="mt-1 text-[24px] leading-tight font-black">Signed in</h2>
            <p className="mt-2 text-[13px]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
              This device is signed in as <b style={{ color: 'var(--ink)' }}>{signedInAs}</b>. Every
              device signed in to this address sees the same trips.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await signOut();
                // The trip stays in this browser deliberately: signing out says
                // something about the database, not about wanting the trip
                // deleted off a laptop.
                window.location.reload();
              }}
              className="mt-4 w-full border px-3 py-2 text-[14px]"
              style={{ borderRadius: 2, borderColor: 'var(--line)', minHeight: 44 }}
            >
              {busy ? 'Signing out' : 'Sign out on this device'}
            </button>
          </>
        ) : !ready ? (
          <p className="mt-3 text-[13px]" style={{ color: 'var(--muted)' }}>
            Checking this device…
          </p>
        ) : reason ? (
          <>
            <h2 className="mt-1 text-[24px] leading-tight font-black">No database</h2>
            <p className="mt-2 text-[13px]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
              This build is not connected to a database, so there is nothing to sign in to. The trip
              is saved in this browser and works exactly as it does otherwise.
            </p>
          </>
        ) : sent ? (
          <>
            <h2 className="mt-1 text-[24px] leading-tight font-black">Enter the code</h2>
            <p className="mt-2 text-[13px]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
              {note}
            </p>
            <label className="eyebrow mt-4 block" htmlFor="account-code">
              Six digit code
            </label>
            <input
              id="account-code"
              className="field mt-1 w-full"
              value={token}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void finish();
              }}
            />
            <button
              type="button"
              disabled={busy || !token.trim()}
              onClick={() => void finish()}
              className="mt-3 w-full text-[14px] font-semibold text-white"
              style={{
                minHeight: 44,
                borderRadius: 2,
                background: 'var(--accent)',
                opacity: busy || !token.trim() ? 0.6 : 1,
              }}
            >
              {busy ? 'Checking' : mode === 'claim' ? 'Finish setting up' : 'Sign in'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setSent(false);
                setToken('');
                setError(null);
              }}
              className="mt-2 w-full border px-3 py-2 text-[13px]"
              style={{ borderRadius: 2, borderColor: 'var(--line)' }}
            >
              Use a different address
            </button>
          </>
        ) : (
          <>
            <h2 className="mt-1 text-[24px] leading-tight font-black">Use your trips anywhere</h2>
            <p className="mt-2 text-[13px]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
              Right now this trip lives in this browser and nowhere else, because a browser with no
              account is its own separate person as far as the database is concerned. An address
              makes your devices one person, so the same trips are listed on all of them. There is
              no password: a six digit code is emailed each time.
            </p>

            <label className="eyebrow mt-4 block" htmlFor="account-email">
              Email address
            </label>
            <input
              ref={first}
              id="account-email"
              className="field mt-1 w-full"
              value={email}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void ask('claim');
              }}
            />

            <button
              type="button"
              disabled={busy || !email.trim()}
              onClick={() => void ask('claim')}
              className="mt-3 w-full text-[14px] font-semibold text-white"
              style={{
                minHeight: 44,
                borderRadius: 2,
                background: 'var(--accent)',
                opacity: busy || !email.trim() ? 0.6 : 1,
              }}
            >
              {busy && mode === 'claim' ? 'Sending' : 'Set up an account with the trips on this device'}
            </button>

            <button
              type="button"
              disabled={busy || !email.trim()}
              onClick={() => void ask('signIn')}
              className="mt-2 w-full border px-3 py-2 text-[14px]"
              style={{ borderRadius: 2, borderColor: 'var(--line)', minHeight: 44 }}
            >
              {busy && mode === 'signIn' ? 'Sending' : 'I already have an account'}
            </button>

            <p className="mt-3 text-[12px]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
              Use the first on the device that has your trips: it puts the address on the identity
              that already owns them, so nothing moves. Use the second on every device after that.
              Signing in leaves behind anything made on this device before signing in, so do the
              first one first.
            </p>
          </>
        )}

        {error && (
          <p className="mt-3 text-[12px]" style={{ color: 'var(--plum)', lineHeight: 1.6 }}>
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="mt-4 w-full border px-3 py-2 text-[13px]"
          style={{ borderRadius: 2, borderColor: 'var(--line)' }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
