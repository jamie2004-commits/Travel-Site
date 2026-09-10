import { useEffect, useMemo, useState } from 'react';
import { myTrips, type OwnedTrip } from '../lib/cloudTrip';
import { switchToTrip } from '../lib/switchTrip';
import { cloudAvailable } from '../lib/identity';
import { describeTrip } from '../lib/tripLabels';
import { useCatalog } from '../lib/CatalogContext';
import { useIdentity } from '../lib/IdentityContext';

interface Props {
  sampleDays: number;
  sampleItems: number;
  onPick: (from: 'sample' | 'blank') => void;
  /** Opens the account dialog, which is how a second device gets a list at all. */
  onSignIn: () => void;
}

/**
 * First visit only. The sample trip used to load silently, which left a new
 * arrival looking at eight full days with no idea whether they were theirs.
 *
 * The third option is the one that makes a trip portable, and it used to be a
 * box for pasting a uuid. A trip row belonged to the browser that made it, so
 * on a second laptop it was invisible -- same trip, different anonymous
 * identity, nothing to see -- and its code was what carried it across.
 *
 * With email sign in the list is simply the account's trips, and it is the same
 * list on every device. Nothing is pasted and nothing has to be carried. A
 * device that is not signed in yet sees no list, which is not a failure to
 * explain away but the honest state: this browser is nobody in particular yet,
 * and the button says so.
 */
export default function StartDialog({ sampleDays, sampleItems, onPick, onSignIn }: Props) {
  const { catalog } = useCatalog();
  const { anonymous, ready } = useIdentity();
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [owned, setOwned] = useState<OwnedTrip[]>([]);
  const [looking, setLooking] = useState(cloudAvailable);
  /** The list could not be fetched, which is not the same as owning no trips. */
  const [listFailed, setListFailed] = useState(false);
  const [chosen, setChosen] = useState('');

  useEffect(() => {
    let live = true;
    void (async () => {
      if (!cloudAvailable) return;
      try {
        const mine = await myTrips();
        if (live) {
          setOwned(mine.trips);
          setListFailed(mine.failed);
        }
      } finally {
        // In a finally so a thrown identity call cannot leave the dialog
        // saying "Looking for your trips" with nothing ever arriving.
        if (live) setLooking(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const rows = useMemo(
    () =>
      owned.map((t) => ({
        id: t.id,
        label: t.itinerary ? describeTrip(t.itinerary, catalog) : t.label?.trim() || 'Trip',
      })),
    [owned, catalog],
  );

  async function open(id: string) {
    if (busy || !id) return;
    setBusy(true);
    setError(null);
    const result = await switchToTrip(id);
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }
    // Everything landed in storage; the reload is what lets the sync layer
    // start from a settled state rather than mid-flight.
    window.location.reload();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: 'rgba(18,33,31,.5)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Start a trip"
        className="w-full max-w-lg border p-5"
        style={{ background: 'var(--card)', borderColor: 'var(--line)', borderRadius: 2 }}
      >
        <p className="eyebrow">Itinerary Builder</p>
        <h2 className="mt-1 text-[26px] leading-tight font-black">Where to start</h2>
        <p className="mt-2 text-[13px]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
          Pick the day you are planning, browse the places, add them to it. A copy is kept in this
          browser and a copy is kept on the server, so it is still here when you come back.
        </p>

        <div className="mt-4 grid gap-2">
          <button
            type="button"
            onClick={() => onPick('sample')}
            className="border p-3 text-left"
            style={{
              borderRadius: 2,
              borderColor: 'var(--accent)',
              background: 'var(--accent-soft)',
            }}
          >
            <span className="block text-[18px] font-semibold">Use the sample trip</span>
            <span className="mt-0.5 block text-[12px]" style={{ color: 'var(--muted)' }}>
              Start from the {sampleDays} day Shanghai and Hangzhou trip, {sampleItems} stops
              already timed. Edit it into your own.
            </span>
          </button>

          <button
            type="button"
            onClick={() => onPick('blank')}
            className="border p-3 text-left"
            style={{ borderRadius: 2, borderColor: 'var(--line)', background: 'var(--card)' }}
          >
            <span className="block text-[18px] font-semibold">Start from blank</span>
            <span className="mt-0.5 block text-[12px]" style={{ color: 'var(--muted)' }}>
              Start blank, with one empty day. Add days as you go.
            </span>
          </button>

          {/* Only offered where there is a server to open a trip from. */}
          {cloudAvailable && !opening && (
            <button
              type="button"
              onClick={() => setOpening(true)}
              className="border p-3 text-left"
              style={{ borderRadius: 2, borderColor: 'var(--line)', background: 'var(--card)' }}
            >
              <span className="block text-[18px] font-semibold">Open a trip you already have</span>
              <span className="mt-0.5 block text-[12px]" style={{ color: 'var(--muted)' }}>
                Every trip on your account, on any device signed in to it.
              </span>
            </button>
          )}
        </div>

        {opening && (
          <div
            className="mt-2 border p-3"
            style={{ borderRadius: 2, borderColor: 'var(--accent)', background: 'var(--card)' }}
          >
            <p className="text-[18px] font-semibold">Open a trip you already have</p>

            {looking && (
              <p className="mt-3 text-[12px]" style={{ color: 'var(--muted)' }}>
                Looking for your trips…
              </p>
            )}

            {listFailed && !looking && (
              <p className="mt-3 text-[12px]" style={{ color: 'var(--plum)', lineHeight: 1.6 }}>
                Could not reach the database to look for your trips, so this list may be incomplete.
                Your trips are not affected. Reload to try again.
              </p>
            )}

            {!looking && rows.length > 0 && (
              <>
                <label className="eyebrow mt-3 block" htmlFor="known-trip">
                  Your trips
                </label>
                <select
                  id="known-trip"
                  className="field mt-1 w-full"
                  value={chosen}
                  onChange={(e) => setChosen(e.target.value)}
                >
                  <option value="">Choose a trip</option>
                  {rows.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void open(chosen)}
                  disabled={busy || !chosen}
                  className="mt-2 w-full border px-3 py-2 text-[14px] font-semibold"
                  style={{
                    borderRadius: 2,
                    borderColor: 'var(--accent)',
                    background: 'var(--accent)',
                    color: '#fff',
                    opacity: busy || !chosen ? 0.6 : 1,
                  }}
                >
                  {busy ? 'Opening' : 'Open this trip'}
                </button>
              </>
            )}

            {/*
              The case this dialog exists for on a second device: no account, so
              no list, and no amount of retrying will produce one. Said plainly,
              with the thing that fixes it attached.
            */}
            {!looking && rows.length === 0 && !listFailed && ready && anonymous && (
              <>
                <p className="mt-3 text-[12px]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
                  This browser has no account, so it has no trips of its own yet. Sign in with the
                  address you used on the device that has your trips and they will all be listed
                  here.
                </p>
                <button
                  type="button"
                  onClick={onSignIn}
                  className="mt-2 w-full text-[14px] font-semibold text-white"
                  style={{ minHeight: 44, borderRadius: 2, background: 'var(--accent)' }}
                >
                  Sign in
                </button>
              </>
            )}

            {!looking && rows.length === 0 && !listFailed && ready && !anonymous && (
              <p className="mt-3 text-[12px]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
                No trips saved on this account yet. Start from the sample or from blank, and it will
                be here on your other devices.
              </p>
            )}

            {error && (
              <p className="mt-3 text-[12px]" style={{ color: 'var(--plum)', lineHeight: 1.6 }}>
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
