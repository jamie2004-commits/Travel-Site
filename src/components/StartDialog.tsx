import { useEffect, useMemo, useState } from 'react';
import type { Itinerary } from '../types';
import { myTrips, openTripByCode, type OwnedTrip } from '../lib/cloudTrip';
import { cloudAvailable } from '../lib/identity';
import { readKnownTrips, tripChoices, type KnownTrip } from '../lib/knownTrips';
import { useCatalog } from '../lib/CatalogContext';
import type { Expense } from '../lib/expenses';

interface Props {
  sampleDays: number;
  sampleItems: number;
  onPick: (from: 'sample' | 'blank') => void;
  /** A trip opened by its code, which arrives with the code that found it. */
  onOpen: (itinerary: Itinerary, code: string, expenses: Expense[]) => void;
}

/**
 * First visit only. The sample trip used to load silently, which left a new
 * arrival looking at eight full days with no idea whether they were theirs.
 *
 * The third option is the one that makes a trip portable. A trip row belongs to
 * the browser that made it, so on a second laptop it is invisible: same trip,
 * different anonymous identity, nothing to see. Its code is what carries it
 * across, and this is where the code is spent.
 */
export default function StartDialog({ sampleDays, sampleItems, onPick, onOpen }: Props) {
  const [opening, setOpening] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The trips this browser has opened before, its own included. Not a query
   * against the server: listing every trip there would let any visitor read
   * every label, and from a label a code, and from a code somebody's flight
   * numbers. A list of codes is a list of permissions and belongs to the
   * browser that was given them.
   */
  const [known, setKnown] = useState<KnownTrip[]>([]);
  /** The same question asked of the database, scoped by RLS to this identity. */
  const [owned, setOwned] = useState<OwnedTrip[]>([]);
  const [looking, setLooking] = useState(cloudAvailable);
  /** The list could not be fetched, which is not the same as owning no trips. */
  const [listFailed, setListFailed] = useState(false);
  const [chosen, setChosen] = useState('');
  const { catalog } = useCatalog();

  useEffect(() => {
    let live = true;
    void (async () => {
      const local = await readKnownTrips();
      if (live) setKnown(local);
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

  const choices = useMemo(
    () => tripChoices(owned, known, catalog),
    [owned, known, catalog],
  );

  async function open(which: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await openTripByCode(which);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onOpen(result.trip.itinerary, which.trim(), result.trip.expenses);
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
                Pick it from the list. A trip made in a different browser is not listed there, and
                needs its trip code once, from Export and more on the machine that has it.
              </span>
            </button>
          )}

          {opening && (
            <div
              className="border p-3"
              style={{ borderRadius: 2, borderColor: 'var(--accent)', background: 'var(--card)' }}
            >
              <p className="text-[18px] font-semibold">Open a trip you already have</p>

              {/*
                The list first, because after the first time on a machine it is
                the whole interaction: pick the trip, open it. The code below is
                only for a machine that has never seen this trip.
              */}
              {looking && (
                <p className="mt-3 text-[12px]" style={{ color: 'var(--muted)' }}>
                  Looking for your trips…
                </p>
              )}

              {listFailed && !looking && (
                <p className="mt-3 text-[12px]" style={{ color: 'var(--plum)' }}>
                  Could not reach the database to look for your trips, so this list may be
                  incomplete. Your trips are not affected. Reload to try again, or open one by its
                  code below.
                </p>
              )}

              {choices.length > 0 && (
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
                    {choices.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.label}
                        {t.mine ? '' : ' (opened here)'}
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

              <label className="eyebrow mt-4 block" htmlFor="trip-code">
                {choices.length > 0 ? 'Or a trip from another machine' : 'Trip code'}
              </label>
              <p className="mt-0.5 text-[12px]" style={{ color: 'var(--muted)' }}>
                Paste its trip code, from Export and more on the machine that has it. It goes in the
                list above once opened, so it only needs pasting once. A trip made in a different
                browser will not be listed above, because that browser holds its own identity.
                Anyone with the code can read and edit that trip, so treat it like the link to a
                shared document.
              </p>
              <input
                id="trip-code"
                className="field mt-1 w-full"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void open(code);
                }}
                placeholder="00000000-0000-0000-0000-000000000000"
                autoComplete="off"
                spellCheck={false}
              />
              {error && (
                <p className="mt-2 text-[12px]" style={{ color: 'var(--plum)' }}>
                  {error}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void open(code)}
                  disabled={busy || !code.trim()}
                  className="border px-3 py-2 text-[14px] font-semibold"
                  style={{
                    borderRadius: 2,
                    borderColor: 'var(--line)',
                    opacity: busy || !code.trim() ? 0.6 : 1,
                  }}
                >
                  {busy ? 'Opening' : 'Open by code'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpening(false);
                    setError(null);
                  }}
                  className="border px-3 py-2 text-[14px]"
                  style={{ borderRadius: 2, borderColor: 'var(--line)', color: 'var(--muted)' }}
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
