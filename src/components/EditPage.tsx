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
import DayCard from './DayCard';
import DayRail from './DayRail';
import DayPicker from './DayPicker';
import ConfirmDialog from './ConfirmDialog';
import Toast from './Toast';
import LibraryPane from './LibraryPane';
import DraggablePlaceCard from './DraggablePlaceCard';
import { SignIn } from './SignIn';
import type { DragData } from './dnd';

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

  const total = sumCosts(days.flatMap((d) => d.items));
  const dayOffset = dayNumberOffset(days);
  const itemCount = days.reduce((n, d) => n + d.items.length, 0);

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
    return itemTitle(catalog, item?.placeId, item?.customTitle).en;
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
                <SignIn />
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
