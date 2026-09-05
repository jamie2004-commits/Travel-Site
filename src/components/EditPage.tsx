import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { City, Place } from '../types';
import type { useItinerary } from '../lib/store';
import { itemTitle } from '../lib/catalog';
import { useCatalog } from '../lib/CatalogContext';
import { formatCostSum, sumCosts } from '../lib/format';
import { dayNumberOffset } from '../lib/days';
import { download, fileStem, toHtml, toText } from '../lib/export';
import { backupFilename, parseBackup, readBackup, summarise, writeBackup } from '../lib/backup';
import type { Backup, BackupSummary } from '../lib/backup';
import { DEFAULT_RATE } from '../lib/expenses';
import { cloudAvailable } from '../lib/identity';
import { loadFromCloud, saveToCloud, tripCodeForThisTrip } from '../lib/cloudTrip';
import DayCard from './DayCard';
import DayRail from './DayRail';
import DayPicker from './DayPicker';
import ConfirmDialog from './ConfirmDialog';
import Toast from './Toast';
import LibraryPane from './LibraryPane';
import DraggablePlaceCard from './DraggablePlaceCard';
import type { DragData } from './dnd';

/**
 * What restoring is about to do, in both directions. Naming what is being
 * replaced matters as much as naming what replaces it: a restore is the one
 * action here that overwrites a trip, and the undo stack does not cover it,
 * because the page reloads.
 */
function restoreBody(
  found: BackupSummary,
  current: BackupSummary,
  from: 'file' | 'database',
): string {
  const when = found.savedAt ? `, saved ${found.savedAt.slice(0, 10)}` : '';
  const name = found.name ? `"${found.name}", ` : '';
  const source = from === 'file' ? 'This file' : 'The copy in the database';
  const noun = from === 'file' ? 'file' : 'copy';

  // Counted, not just listed. An absent section and an empty one look the same
  // in a sentence that says "with 0 expenses" only when there are some: the
  // first keeps what is here, the second erases it, and the difference has to
  // be on screen before a button that cannot be undone.
  const lines = [
    `${source} holds ${name}${found.days} days and ${found.stops} stops${when}.`,
    `It replaces the ${current.days} days and ${current.stops} stops in this browser now.`,
  ];

  if (found.expenses > 0) {
    lines.push(`Its ${found.expenses} expenses replace the ${current.expenses} here.`);
  } else if (found.hasExpenses) {
    lines.push(
      current.expenses > 0
        ? `It carries an empty ledger, so the ${current.expenses} expenses here are removed.`
        : `It carries an empty ledger, like this browser.`,
    );
  } else {
    lines.push(`It carries no ledger, so the ${current.expenses} expenses here are kept.`);
  }

  if (found.places > 0) {
    lines.push(`Its ${found.places} added places replace the ${current.places} here.`);
  } else if (found.hasPlaces && current.places > 0) {
    lines.push(`It carries no added places, so the ${current.places} here are removed.`);
  } else if (!found.hasPlaces && current.places > 0) {
    lines.push(`The ${current.places} places added here are kept.`);
  }

  lines.push(
    `None of this can be undone. Save a copy first if this is not the ${noun} you meant.`,
  );
  return lines.join(' ');
}

interface Props {
  trip: ReturnType<typeof useItinerary>;
  onSheet: () => void;
  onActivities: () => void;
  /** The day adding lands in, shared with the activities page. */
  activeDayId: string | null;
  setActiveDayId: (dayId: string | null) => void;
}

/**
 * Editing, as a page of its own.
 *
 * This was the right half of a two-pane builder, which is why a day card was
 * always about as wide as a phone: the library took the other half whether or
 * not anything was being browsed. Now that browsing has the activities page,
 * the days get the full width, the toolbar and the day rail follow you down a
 * long trip, and the library is a drawer you open when you want it — docked
 * beside the days on a wide screen so places can still be dragged onto a day.
 */
export default function EditPage({
  trip,
  onSheet,
  onActivities,
  activeDayId,
  setActiveDayId,
}: Props) {
  const { catalog } = useCatalog();
  const { state, dispatch, usage, canUndo, undoLabel, undo } = trip;
  const { itinerary } = state;
  const days = itinerary.days;

  const [city, setCity] = useState<City>('hangzhou');
  const [library, setLibrary] = useState(false);
  const [more, setMore] = useState(false);
  const [pending, setPending] = useState<Place | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const daysRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** A parsed backup waiting on the user to confirm it may replace the trip. */
  const [pendingRestore, setPendingRestore] = useState<{
    backup: Backup;
    summary: BackupSummary;
    from: 'file' | 'database';
  } | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);

  const total = sumCosts(days.flatMap((d) => d.items));
  const dayOffset = dayNumberOffset(days);
  const itemCount = days.reduce((n, d) => n + d.items.length, 0);

  /**
   * What is in this browser now, in the same shape a file is summarised in, so
   * the restore dialog can compare like with like. The ledger and the places
   * are read from storage rather than from state, because this page holds
   * neither: the trip is the only half it can see.
   */
  const [currentSummary, setCurrentSummary] = useState<BackupSummary>({
    days: 0,
    stops: 0,
    expenses: 0,
    places: 0,
    hasExpenses: false,
    hasPlaces: false,
  });
  useEffect(() => {
    // Only while the dialog is up, so a page that never restores never reads.
    if (!pendingRestore) return;
    let live = true;
    void readBackup().then((here) => {
      if (live) setCurrentSummary(summarise(here));
    });
    return () => {
      live = false;
    };
  }, [pendingRestore]);

  // The day everything adds to. Adding used to stop and ask every single time,
  // which made an eight day trip eight questions deep.
  const activeDay = days.find((d) => d.id === activeDayId) ?? days[0] ?? null;

  // Counts for the day on screen, so a card can say "already in this day"
  // separately from "somewhere in the trip".
  const dayUsage = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of activeDay?.items ?? []) {
      if (item.placeId) counts[item.placeId] = (counts[item.placeId] ?? 0) + 1;
    }
    return counts;
  }, [activeDay]);

  useEffect(() => {
    document.documentElement.dataset.city = city;
  }, [city]);

  // Choosing a day on the rail brings its card into view, so the rail and the
  // page never disagree about what is being worked on.
  useEffect(() => {
    if (!activeDayId) return;
    const node = daysRef.current?.querySelector(`[data-day-id="${activeDayId}"]`);
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeDayId]);

  const addToDay = useCallback(
    (place: Place, dayId: string) => {
      dispatch({ type: 'addPlace', dayId, place });
      setActiveDayId(dayId);
      const day = days.find((d) => d.id === dayId);
      setToast(`Added to ${day?.label ?? ''} · ${place.nameEn}`);
    },
    [dispatch, days, setActiveDayId],
  );

  // Adding goes to the day on the rail, no question asked. The caret on the
  // card is there for the times it belongs somewhere else.
  const onAdd = useCallback(
    (place: Place) => {
      if (!days.length) {
        dispatch({ type: 'addDay' });
        setToast('Added a day first');
        return;
      }
      addToDay(place, activeDay?.id ?? days[0].id);
    },
    [days, activeDay, addToDay, dispatch],
  );

  const onAddElsewhere = useCallback(
    (place: Place) => {
      if (days.length <= 1) {
        onAdd(place);
        return;
      }
      setPending(place);
    },
    [days, onAdd],
  );

  const sensors = useSensors(
    // A short distance keeps the add button and the remove button clickable.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragging, setDragging] = useState<DragData | null>(null);

  const onDragStart = useCallback((event: DragStartEvent) => {
    setDragging((event.active.data.current as DragData) ?? null);
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragging(null);
      const active = event.active.data.current as DragData | undefined;
      const over = event.over?.data.current as
        | { type: 'day'; dayId: string }
        | { type: 'item'; dayId: string; index: number }
        | undefined;
      if (!active || !over) return;

      // Dropping on a day appends; dropping on an item inserts at its place.
      const toDayId = over.dayId;
      const toIndex =
        over.type === 'item'
          ? over.index
          : (days.find((d) => d.id === toDayId)?.items.length ?? 0);

      if (active.type === 'place') {
        dispatch({ type: 'addPlace', dayId: toDayId, place: active.place, index: toIndex });
        setActiveDayId(toDayId);
        const day = days.find((d) => d.id === toDayId);
        setToast(`Added to ${day?.label ?? ''} · ${active.place.nameEn}`);
        return;
      }

      if (active.dayId === toDayId && active.index === toIndex) return;
      dispatch({
        type: 'moveItem',
        fromDayId: active.dayId,
        toDayId,
        itemId: active.itemId,
        toIndex,
      });
    },
    [days, dispatch, setActiveDayId],
  );

  const draggingTitle = () => {
    if (!dragging) return null;
    if (dragging.type === 'place') return dragging.place.nameEn;
    const item = days
      .find((d) => d.id === dragging.dayId)
      ?.items.find((i) => i.id === dragging.itemId);
    const t = itemTitle(catalog, item?.placeId, item?.customTitle);
    // The name, whichever field holds it. Reading .en alone showed nothing for a
    // custom item and, once a note existed, showed the note for a lost place.
    return t.zh || t.en;
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragCancel={() => setDragging(null)}
      onDragEnd={onDragEnd}
    >
      <div className="edit">
        <header className="edit-head">
          <div className="edit-wrap">
            <div className="edit-topline">
              <p className="eyebrow">Editing · Shanghai · Hangzhou</p>
              <div className="edit-jumpto">
                <button type="button" onClick={onActivities}>
                  Things to do
                </button>
                <button type="button" onClick={onSheet}>
                  The sheet
                </button>
              </div>
            </div>

            <label className="sr-only" htmlFor="trip-name">
              Trip name
            </label>
            <input
              id="trip-name"
              className="edit-name"
              value={itinerary.name}
              onChange={(e) => dispatch({ type: 'renameTrip', name: e.target.value })}
            />

            <p className="edit-counts">
              <span>
                <b>{formatCostSum(total)}</b> estimated
              </span>
              <span>
                <b>{days.length}</b> days
              </span>
              <span>
                <b>{itemCount}</b> stops
              </span>
            </p>
          </div>
        </header>

        <div className={`edit-body${library ? ' with-library' : ''}`}>
          <div className="edit-column">
            <div className="edit-tools">
              <div className="edit-wrap edit-toolrow">
                <button
                  type="button"
                  className="primary"
                  onClick={() => dispatch({ type: 'addDay' })}
                >
                  Add day
                </button>
                <button
                  type="button"
                  className={library ? 'on' : undefined}
                  aria-expanded={library}
                  onClick={() => setLibrary((v) => !v)}
                >
                  {library ? 'Hide the library' : 'Add places'}
                </button>
                <button type="button" onClick={undo} disabled={!canUndo} title={undoLabel}>
                  Undo
                  {canUndo && <span className="edit-undolabel">{undoLabel}</span>}
                </button>
                <button
                  type="button"
                  className={`spacer${more ? ' on' : ''}`}
                  aria-expanded={more}
                  onClick={() => setMore((v) => !v)}
                >
                  Export and more
                </button>
              </div>

              {more && (
                <div className="edit-wrap">
                  <div className="edit-more">
                    <button
                      type="button"
                      onClick={() => {
                        download(
                          `${fileStem(itinerary.name)}.html`,
                          toHtml(itinerary, catalog),
                          'text/html',
                        );
                        setToast('Downloaded as HTML');
                      }}
                    >
                      Export HTML
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const text = toText(itinerary, catalog);
                        try {
                          await navigator.clipboard.writeText(text);
                          setToast('Copied as plain text');
                        } catch {
                          download(`${fileStem(itinerary.name)}.txt`, text, 'text/plain');
                          setToast('Downloaded as plain text');
                        }
                      }}
                    >
                      Copy as text
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const backup = await readBackup();
                          download(
                            backupFilename(itinerary.name),
                            JSON.stringify(backup, null, 2),
                            'application/json',
                          );
                          const s = summarise(backup);
                          setToast(`Saved a copy: ${s.days} days, ${s.stops} stops`);
                        } catch (cause) {
                          console.error('Could not read a backup out of this browser.', cause);
                          setToast('Could not read this browser to make a copy');
                        }
                      }}
                    >
                      Save a copy
                    </button>
                    <button type="button" onClick={() => fileInput.current?.click()}>
                      Restore a copy
                    </button>
                    {cloudAvailable && (
                      <>
                        <button
                          type="button"
                          disabled={cloudBusy}
                          onClick={async () => {
                            setCloudBusy(true);
                            // Straight from storage. Owning a useExpenses here
                            // would put a second write-through on a key the
                            // expenses page already owns.
                            const here = await readBackup();
                            const result = await saveToCloud(
                              itinerary,
                              here.expenses ?? [],
                              here.rate ?? DEFAULT_RATE,
                            );
                            setCloudBusy(false);
                            setToast(
                              result.ok
                                ? `Saved to the database. ${itemCount} stops across ${days.length} days.`
                                : result.message,
                            );
                          }}
                        >
                          {cloudBusy ? 'Saving' : 'Save to the database'}
                        </button>
                        <button
                          type="button"
                          disabled={cloudBusy}
                          onClick={async () => {
                            // The code that opens this trip on another machine.
                            // Read fresh rather than held in state, because it
                            // only exists once the trip has reached the server.
                            setCloudBusy(true);
                            const found = await tripCodeForThisTrip();
                            setCloudBusy(false);
                            if (!found) {
                              setToast('No trip code yet. Save to the database first.');
                              return;
                            }
                            try {
                              await navigator.clipboard.writeText(found);
                              setToast(`Trip code copied. ${found}`);
                            } catch {
                              // Clipboard blocked, so show it to be read off.
                              setToast(`Trip code: ${found}`);
                            }
                          }}
                        >
                          Copy the trip code
                        </button>
                        <button
                          type="button"
                          disabled={cloudBusy}
                          onClick={async () => {
                            setCloudBusy(true);
                            const result = await loadFromCloud();
                            setCloudBusy(false);
                            if (!result.ok) {
                              setToast(result.message);
                              return;
                            }
                            if (!result.backup) {
                              setToast('Nothing saved to the database from this browser yet.');
                              return;
                            }
                            // Straight into the same confirmation a file goes
                            // through, so restoring from either source names
                            // both sides and cannot be done by accident.
                            setPendingRestore({
                              backup: result.backup,
                              summary: summarise(result.backup),
                              from: 'database',
                            });
                          }}
                        >
                          Restore from the database
                        </button>
                      </>
                    )}
                    <button type="button" className="spacer danger" onClick={() => setConfirmReset(true)}>
                      Reset
                    </button>
                  </div>
                </div>
              )}

              <div className="edit-wrap">
                <DayRail
                  days={days}
                  activeDayId={activeDay?.id ?? null}
                  onSelect={setActiveDayId}
                  onAddDay={() => dispatch({ type: 'addDay' })}
                />
              </div>
            </div>

            <div className="edit-wrap">
              <div className="edit-days" ref={daysRef}>
                {days.map((day, i) => (
                  <div key={day.id} data-day-id={day.id}>
                    <DayCard
                      day={day}
                      index={i}
                      number={i + dayOffset}
                      total={days.length}
                      onRemoveDay={() => dispatch({ type: 'removeDay', dayId: day.id })}
                      onMoveDay={(direction) =>
                        dispatch({
                          type: 'moveDay',
                          from: i,
                          to: Math.max(0, Math.min(days.length - 1, i + direction)),
                        })
                      }
                      onRemoveItem={(itemId) =>
                        dispatch({ type: 'removeItem', dayId: day.id, itemId })
                      }
                      onChangeItem={(itemId, patch) =>
                        dispatch({ type: 'updateItem', dayId: day.id, itemId, patch })
                      }
                      onAddCustom={(title) => dispatch({ type: 'addCustom', dayId: day.id, title })}
                      onChangeDay={(patch) => dispatch({ type: 'updateDay', dayId: day.id, patch })}
                      active={day.id === activeDayId}
                      onFocus={() => setActiveDayId(day.id)}
                      onRetime={(start, every) =>
                        dispatch({ type: 'retimeDay', dayId: day.id, start, every })
                      }
                    />
                  </div>
                ))}
                {days.length === 0 && (
                  <p className="edit-empty">
                    No days yet
                    <span>Add a day to start</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          {library && (
            <>
              <button
                type="button"
                className="edit-scrim"
                aria-label="Close the library"
                onClick={() => setLibrary(false)}
              />
              <aside className="edit-library" aria-label="Place library">
                <div className="edit-libhead">
                  <p className="eyebrow">Adding to {activeDay?.label ?? 'no day yet'}</p>
                  <button type="button" onClick={() => setLibrary(false)}>
                    Done
                  </button>
                </div>
                <div className="edit-libbody">
                  <LibraryPane
                    city={city}
                    onCityChange={setCity}
                    usage={usage}
                    dayUsage={dayUsage}
                    activeDay={activeDay}
                    onAdd={onAdd}
                    onAddElsewhere={onAddElsewhere}
                    onAdded={setToast}
                  onPlaceDeleted={(place) =>
                    dispatch({
                      type: 'detachPlace',
                      placeId: place.id,
                      title: place.nameZh || place.nameEn,
                    })
                  }
                    renderCard={(place, card) => (
                      <DraggablePlaceCard place={place}>{card}</DraggablePlaceCard>
                    )}
                  />
                </div>
              </aside>
            </>
          )}
        </div>

        {pending && (
          <DayPicker
            days={days}
            title={pending.nameEn}
            onPick={(dayId) => {
              addToDay(pending, dayId);
              setPending(null);
            }}
            onCancel={() => setPending(null)}
          />
        )}

        {confirmReset && (
          <ConfirmDialog
            title="Reset the itinerary"
            body="This clears every day and every item and starts again with one empty day. Undo will bring it back."
            confirmLabel="Reset"
            onConfirm={() => {
              dispatch({ type: 'reset' });
              setConfirmReset(false);
              setToast('Reset');
            }}
            onCancel={() => setConfirmReset(false)}
          />
        )}

        {pendingRestore && (
          <ConfirmDialog
            title="Restore this copy"
            body={restoreBody(pendingRestore.summary, currentSummary, pendingRestore.from)}
            confirmLabel="Restore"
            onConfirm={() => {
              const { backup } = pendingRestore;
              setPendingRestore(null);
              // Written straight to storage, then the page is reloaded. Feeding
              // it through the reducer instead would race every write-through
              // effect. writeBackup is one transaction, so the message below is
              // true: a failure leaves everything exactly as it was.
              void writeBackup(backup)
                .then(() => window.location.reload())
                .catch((cause) => {
                  console.error('Could not write the restored copy.', cause);
                  setToast('Could not write the restored copy. Nothing was changed.');
                });
            }}
            onCancel={() => setPendingRestore(null)}
          />
        )}

        {/* Off screen, opened by the Restore button. A file picker cannot be
            styled, so the button is the control and this is the mechanism. */}
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared straight away so choosing the same file twice still fires.
            e.target.value = '';
            if (!file) return;
            void file
              .text()
              .then((text) => {
                const parsed = parseBackup(text);
                if (!parsed.ok) {
                  setToast(parsed.message);
                  return;
                }
                setPendingRestore({
                  backup: parsed.backup,
                  summary: summarise(parsed.backup),
                  from: 'file',
                });
              })
              .catch(() => setToast('That file could not be read.'));
          }}
        />

        <Toast message={toast} onDone={() => setToast(null)} />
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div
            className="border px-3 py-2 text-[15px] font-semibold shadow-lg"
            style={{ background: 'var(--card)', borderColor: 'var(--accent)', borderRadius: 2 }}
          >
            {draggingTitle()}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
