import { useEffect, useMemo, useRef, useState } from 'react';
import type { Itinerary } from '../types';
import { myTrips, createTrip, deleteTrip, renameTrip, type OwnedTrip } from '../lib/cloudTrip';
import { switchToTrip } from '../lib/switchTrip';
import { readOpenTripId, forgetOpenTripId } from '../lib/openTrip';
import { describeTrip } from '../lib/tripLabels';
import { useCatalog } from '../lib/CatalogContext';
import { useIdentity } from '../lib/IdentityContext';
import { emptyItinerary } from '../lib/store';

interface Props {
  onClose: () => void;
  /** What is on screen, so "start another" can say what it is keeping. */
  current: Itinerary;
  onSignIn: () => void;
}

/**
 * Every trip on the account, and which one this device is editing.
 *
 * The list itself is not new -- the opening dialog had one -- but it could only
 * ever show trips this *browser* had made or been handed a code for, because an
 * anonymous identity is one browser. It was reachable exactly once, on a first
 * visit, since it only rendered when there was no stored trip, which is why
 * switching trips previously meant clearing the site's data. Both of those are
 * fixed here rather than in the list: an account makes the answer the same on
 * every device, and this is a dialog you can open whenever you like.
 *
 * Which trip a device has open is a property of the device. Two devices on two
 * different trips is a supported state, not a bug to reconcile: 0011 dropped
 * the one-active-per-owner index precisely so the laptop can stay on next
 * year's trip while the phone is open on this week's.
 */
export default function TripsDialog({ onClose, current, onSignIn }: Props) {
  const { catalog } = useCatalog();
  const { anonymous, ready, reason } = useIdentity();
  const [trips, setTrips] = useState<OwnedTrip[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [chosen, setChosen] = useState('');
  const [looking, setLooking] = useState(true);
  /** A failed list and an empty one call for opposite things. Never merged. */
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const first = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [mine, id] = await Promise.all([myTrips(), readOpenTripId()]);
      if (!live) return;
      setTrips(mine.trips);
      setFailed(mine.failed);
      setOpenId(id);
      setChosen(id ?? '');
      setLooking(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  /**
   * The label comes from the document rather than the stored `label` column,
   * which is written once at save time and goes stale the moment a city is
   * added. The column is the fallback for a trip whose document did not come
   * back, and it is the older "China 2026, 17 Sep 2026" shape.
   */
  const rows = useMemo(
    () =>
      trips.map((t) => ({
        id: t.id,
        label: t.itinerary ? describeTrip(t.itinerary, catalog) : t.label?.trim() || 'Trip',
        days: t.itinerary?.days?.length ?? 0,
      })),
    [trips, catalog],
  );

  const openRow = rows.find((r) => r.id === openId);

  async function open(id: string) {
    if (!id || busy) return;
    setBusy('open');
    setError(null);
    const result = await switchToTrip(id);
    if (!result.ok) {
      setBusy(null);
      setError(result.message);
      return;
    }
    // Reload rather than re-render. switchToTrip has just rewritten the stored
    // trip, the ledger, the lists and three pieces of sync bookkeeping under a
    // running sync loop, and restarting is far cheaper to reason about than
    // re-pointing every layer mid-flight.
    window.location.reload();
  }

  async function startAnother() {
    if (busy) return;
    setBusy('new');
    setError(null);
    // The trip on screen is already a row on the server, so nothing needs
    // saving first. This inserts a second one, which 0011 made possible.
    const made = await createTrip(emptyItinerary());
    if (!made.ok) {
      setBusy(null);
      setError(made.message);
      return;
    }
    const moved = await switchToTrip(made.id);
    if (!moved.ok) {
      setBusy(null);
      setError(moved.message);
      return;
    }
    window.location.reload();
  }

  async function rename() {
    if (!openId || !renaming.trim() || busy) return;
    setBusy('rename');
    const result = await renameTrip(openId, renaming.trim());
    setBusy(null);
    if (!result.ok) {
      setError(result.message ?? 'Could not rename that trip.');
      return;
    }
    setTrips((all) =>
      all.map((t) => (t.id === openId ? { ...t, label: renaming.trim() } : t)),
    );
    setRenaming('');
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy('delete');
    const result = await deleteTrip(id);
    if (!result.ok) {
      setBusy(null);
      setError(result.message ?? 'Could not delete that trip.');
      return;
    }
    setConfirmDelete(null);

    // Deleting the trip this device is on leaves the pointer naming nothing.
    // Dropped, so the next load asks rather than failing to find it.
    if (id === openId) {
      await forgetOpenTripId();
      window.location.reload();
      return;
    }
    setTrips((all) => all.filter((t) => t.id !== id));
    setBusy(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: 'rgba(18,33,31,.5)' }}
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Your trips"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg border p-5"
        style={{ background: 'var(--card)', borderColor: 'var(--line)', borderRadius: 2 }}
      >
        <p className="eyebrow">Trips</p>
        <h2 className="mt-1 text-[24px] leading-tight font-black">
          {openRow ? openRow.label : current.name?.trim() || 'This trip'}
        </h2>
        <p className="mt-2 text-[13px]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
          {openRow
            ? 'This is the trip this device is editing. Every device signed in to your account can open any of these.'
            : 'This device has not been put on one of your saved trips yet.'}
        </p>

        {/*
          Without an account the list can only ever hold trips made in this one
          browser, so saying that plainly beats showing a list of one and
          letting somebody wonder where the others went.
        */}
        {ready && !reason && anonymous && (
          <div
            className="mt-4 border p-3"
            style={{ borderRadius: 2, borderColor: 'var(--accent)', background: 'var(--accent-soft)' }}
          >
            <p className="text-[13px]" style={{ lineHeight: 1.6 }}>
              This device has no account yet, so this list can only show trips made in this browser.
              Add an email and the same trips appear on your phone.
            </p>
            <button
              type="button"
              onClick={onSignIn}
              className="mt-2 w-full text-[14px] font-semibold text-white"
              style={{ minHeight: 40, borderRadius: 2, background: 'var(--accent)' }}
            >
              Set up an account
            </button>
          </div>
        )}

        {looking && (
          <p className="mt-4 text-[12px]" style={{ color: 'var(--muted)' }}>
            Looking for your trips…
          </p>
        )}

        {failed && !looking && (
          <p className="mt-4 text-[12px]" style={{ color: 'var(--plum)', lineHeight: 1.6 }}>
            Could not reach the database, so this list may be incomplete. Your trips are not
            affected. Close this and open it again to retry.
          </p>
        )}

        {!looking && rows.length > 0 && (
          <>
            <label className="eyebrow mt-4 block" htmlFor="trip-picker">
              Your trips
            </label>
            <select
              ref={first}
              id="trip-picker"
              className="field mt-1 w-full"
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
            >
              <option value="">Choose a trip</option>
              {rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                  {r.days ? ` · ${r.days} ${r.days === 1 ? 'day' : 'days'}` : ''}
                  {r.id === openId ? ' · open here' : ''}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={!chosen || chosen === openId || busy !== null}
              onClick={() => void open(chosen)}
              className="mt-2 w-full text-[14px] font-semibold text-white"
              style={{
                minHeight: 44,
                borderRadius: 2,
                background: 'var(--accent)',
                opacity: !chosen || chosen === openId || busy ? 0.6 : 1,
              }}
            >
              {busy === 'open'
                ? 'Opening'
                : chosen && chosen === openId
                  ? 'Already open on this device'
                  : 'Edit this trip on this device'}
            </button>

            {/*
              Deleting is offered for the chosen row rather than the open one,
              so a trip can be thrown away without first switching onto it.
            */}
            {chosen && confirmDelete !== chosen && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setConfirmDelete(chosen)}
                className="mt-2 w-full border px-3 py-2 text-[13px]"
                style={{ borderRadius: 2, borderColor: 'var(--line)', color: 'var(--muted)' }}
              >
                Delete the chosen trip
              </button>
            )}

            {confirmDelete === chosen && chosen && (
              <div
                className="mt-2 border p-3"
                style={{ borderRadius: 2, borderColor: 'var(--plum)' }}
              >
                <p className="text-[13px]" style={{ lineHeight: 1.6 }}>
                  Delete <b>{rows.find((r) => r.id === chosen)?.label}</b> for every device, with its
                  expenses and its packing list? A saved copy on disk is the only way back.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => setConfirmDelete(null)}
                    className="flex-1 border text-[13px]"
                    style={{ minHeight: 40, borderRadius: 2, borderColor: 'var(--line)' }}
                  >
                    Keep it
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void remove(chosen)}
                    className="flex-1 text-[13px] font-semibold text-white"
                    style={{ minHeight: 40, borderRadius: 2, background: 'var(--plum)' }}
                  >
                    {busy === 'delete' ? 'Deleting' : 'Delete it'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {!looking && rows.length === 0 && !failed && (
          <p className="mt-4 text-[12px]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
            No saved trips yet. The trip on screen is saved as you edit it, and will be listed here
            once it has reached the database.
          </p>
        )}

        <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void startAnother()}
            className="w-full border px-3 py-2 text-[14px] font-semibold"
            style={{ borderRadius: 2, borderColor: 'var(--accent)', minHeight: 44 }}
          >
            {busy === 'new' ? 'Starting' : 'Keep this one and start another'}
          </button>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
            Starts an empty trip and moves this device onto it. What is on screen stays where it is
            and comes back from the list above.
          </p>
        </div>

        {openId && (
          <div className="mt-4">
            <label className="eyebrow block" htmlFor="trip-rename">
              Rename this trip
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="trip-rename"
                className="field flex-1"
                value={renaming}
                placeholder={openRow?.label ?? 'A name for the list'}
                onChange={(e) => setRenaming(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void rename();
                }}
              />
              <button
                type="button"
                disabled={!renaming.trim() || busy !== null}
                onClick={() => void rename()}
                className="border px-3 text-[13px]"
                style={{ borderRadius: 2, borderColor: 'var(--line)', minHeight: 40 }}
              >
                {busy === 'rename' ? 'Saving' : 'Rename'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 text-[12px]" style={{ color: 'var(--plum)', lineHeight: 1.6 }}>
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={busy !== null}
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
