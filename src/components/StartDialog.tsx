import { useState } from 'react';
import type { Itinerary } from '../types';
import { openTripByCode } from '../lib/cloudTrip';
import { cloudAvailable } from '../lib/identity';

interface Props {
  sampleDays: number;
  sampleItems: number;
  onPick: (from: 'sample' | 'blank') => void;
  /** A trip opened by its code, which arrives with the code that found it. */
  onOpen: (itinerary: Itinerary, code: string, version: number) => void;
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

  async function open() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await openTripByCode(code);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onOpen(result.trip.itinerary, code.trim(), result.trip.version);
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
                For a trip made on another laptop or phone. You will need its trip code, which is
                on the editor's Export and more menu on the machine that has it.
              </span>
            </button>
          )}

          {opening && (
            <div
              className="border p-3"
              style={{ borderRadius: 2, borderColor: 'var(--accent)', background: 'var(--card)' }}
            >
              <label className="block text-[18px] font-semibold" htmlFor="trip-code">
                Open a trip you already have
              </label>
              <p className="mt-0.5 text-[12px]" style={{ color: 'var(--muted)' }}>
                Paste the trip code from the machine that has it. Anyone with the code can read and
                edit that trip, so it is worth treating like the link to a shared document.
              </p>
              <input
                id="trip-code"
                className="field mt-2 w-full"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void open();
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
                  onClick={() => void open()}
                  disabled={busy || !code.trim()}
                  className="border px-3 py-2 text-[14px] font-semibold"
                  style={{
                    borderRadius: 2,
                    borderColor: 'var(--accent)',
                    background: 'var(--accent)',
                    color: '#fff',
                    opacity: busy || !code.trim() ? 0.6 : 1,
                  }}
                >
                  {busy ? 'Opening' : 'Open it'}
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
