import { useCallback, useEffect, useMemo, useState } from 'react';
import { SignIn } from './components/SignIn';
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
import type { City, Place } from './types';
import LibraryPane from './components/LibraryPane';
import ItineraryPane from './components/ItineraryPane';
import DayPicker from './components/DayPicker';
import DayRail from './components/DayRail';
import StartDialog from './components/StartDialog';
import { starterItinerary } from './data/starterItinerary';
import ConfirmDialog from './components/ConfirmDialog';
import Toast from './components/Toast';
import DraggablePlaceCard from './components/DraggablePlaceCard';
import type { DragData } from './components/dnd';
import { useItinerary } from './lib/store';
import { itemTitle } from './lib/catalog';
import { CatalogProvider, useCatalog } from './lib/CatalogContext';
import ItineraryView from './components/ItineraryView';
import ActivitiesPage from './components/ActivitiesPage';
import { useRoute } from './lib/route';

type Tab = 'browse' | 'trip';

type Trip = ReturnType<typeof useItinerary>;

interface BuilderProps {
  trip: Trip;
  onView: () => void;
  onActivities: () => void;
  /** The day adding lands in, shared with the activities page. */
  activeDayId: string | null;
  setActiveDayId: (dayId: string | null) => void;
}

function Builder({ trip, onView, onActivities, activeDayId, setActiveDayId }: BuilderProps) {
  const [city, setCity] = useState<City>('hangzhou');
  const [tab, setTab] = useState<Tab>('browse');
  const [pending, setPending] = useState<Place | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { catalog } = useCatalog();
  const { state, dispatch, usage, canUndo, undoLabel, undo } = trip;
  const days = state.itinerary.days;

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

  const addToDay = useCallback(
    (place: Place, dayId: string) => {
      dispatch({ type: 'addPlace', dayId, place });
      setActiveDayId(dayId);
      const day = days.find((d) => d.id === dayId);
      setToast(`Added to ${day?.label ?? ''} · ${place.nameEn}`);
    },
    [dispatch, days],
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
    [days, dispatch],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragCancel={() => setDragging(null)}
      onDragEnd={onDragEnd}
    >
    <div className="flex h-full flex-col" style={{ background: 'var(--bg)' }}>
      <header
        className="flex shrink-0 items-center gap-3 border-b px-4 py-3"
        style={{ borderColor: 'var(--line)', background: 'var(--mist)' }}
      >
        <div className="min-w-0">
          <p className="eyebrow">Shanghai · Hangzhou</p>
          <h1 className="text-[22px] leading-tight font-black">Itinerary Builder</h1>
        </div>
        <p className="ml-auto hidden text-right text-[11px] sm:block" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
          Pick the day below, then add places to it
        </p>
        <SignIn />
        <div className="ml-auto flex shrink-0 gap-2 sm:ml-3">
          <button
            type="button"
            onClick={onActivities}
            className="border px-3 text-[13px]"
            style={{
              minHeight: 40,
              borderRadius: 2,
              borderColor: 'var(--line)',
              color: 'var(--muted)',
              background: 'var(--card)',
            }}
          >
            Activities
          </button>
          <button
            type="button"
            onClick={onView}
            className="border px-3 text-[13px]"
            style={{
              minHeight: 40,
              borderRadius: 2,
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
              background: 'var(--card)',
            }}
          >
            View the sheet
          </button>
        </div>
      </header>

      <DayRail
        days={days}
        activeDayId={activeDay?.id ?? null}
        onSelect={setActiveDayId}
        onAddDay={() => dispatch({ type: 'addDay' })}
      />

      {/* Mobile: two tabs. Desktop: both panes side by side. */}
      <nav
        className="flex shrink-0 border-b md:hidden"
        style={{ borderColor: 'var(--line)' }}
        aria-label="Panes"
      >
        {(
          [
            ['browse', 'Browse'],
            ['trip', `My Trip · ${days.reduce((n, d) => n + d.items.length, 0)}`],
          ] as [Tab, string][]
        ).map(([id, label]) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={active ? 'page' : undefined}
              className="flex-1 text-[16px]"
              style={{
                minHeight: 48,
                color: active ? 'var(--ink)' : 'var(--muted)',
                fontWeight: active ? 600 : 400,
                borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                background: active ? 'var(--accent-soft)' : 'transparent',
              }}
            >
              {label}
            </button>
          );
        })}
      </nav>

      <main className="grid min-h-0 flex-1 md:grid-cols-2">
        <div
          className={`${tab === 'browse' ? 'flex' : 'hidden'} min-h-0 md:flex md:border-r`}
          style={{ borderColor: 'var(--line)' }}
        >
          <div className="min-h-0 w-full">
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
        </div>

        <div className={`${tab === 'trip' ? 'flex' : 'hidden'} min-h-0 md:flex`}>
          <div className="min-h-0 w-full">
            <ItineraryPane
              state={state}
              dispatch={dispatch}
              canUndo={canUndo}
              undoLabel={undoLabel}
              onUndo={undo}
              onReset={() => setConfirmReset(true)}
              onExported={setToast}
              activeDayId={activeDay?.id ?? null}
              onFocusDay={setActiveDayId}
            />
          </div>
        </div>
      </main>

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
            {dragging.type === 'place'
              ? dragging.place.nameEn
              : itemTitle(
                  catalog,
                  days
                    .find((d) => d.id === dragging.dayId)
                    ?.items.find((i) => i.id === dragging.itemId)?.placeId,
                  days
                    .find((d) => d.id === dragging.dayId)
                    ?.items.find((i) => i.id === dragging.itemId)?.customTitle,
                ).en}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * Three pages over one stored trip: the sheet you read, the builder you edit it
 * in, and the activities page you browse. They were one screen, which meant the
 * itinerary was only ever visible as half a window with a library beside it,
 * and a thing to do was three lines in a column narrower than this sentence.
 *
 * The day being filled lives here rather than in the builder, so browsing
 * activities and adding to the trip are the same act, and coming back to the
 * builder lands on the day you were just adding to.
 */
function Pages() {
  const trip = useItinerary();
  const [route, go] = useRoute();
  const [activeDayId, setActiveDayId] = useState<string | null>(null);
  const days = trip.state.itinerary.days;

  useEffect(() => {
    if (!days.length) {
      if (activeDayId !== null) setActiveDayId(null);
      return;
    }
    if (!days.some((d) => d.id === activeDayId)) setActiveDayId(days[0].id);
  }, [days, activeDayId]);

  if (!trip.loaded) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: 'var(--bg)' }}>
        <p className="eyebrow">Loading</p>
      </div>
    );
  }

  return (
    <>
      {route === 'build' && (
        <Builder
          trip={trip}
          onView={() => go('sheet')}
          onActivities={() => go('activities')}
          activeDayId={activeDayId}
          setActiveDayId={setActiveDayId}
        />
      )}
      {route === 'activities' && (
        <ActivitiesPage
          days={days}
          activeDayId={activeDayId}
          onSelectDay={setActiveDayId}
          onAdd={(place, dayId) => {
            trip.dispatch({ type: 'addPlace', dayId, place });
            setActiveDayId(dayId);
          }}
          usage={trip.usage}
          onBuild={() => go('build')}
          onSheet={() => go('sheet')}
        />
      )}
      {route === 'sheet' && (
        <ItineraryView
          itinerary={trip.state.itinerary}
          onEdit={() => go('build')}
          onActivities={() => go('activities')}
        />
      )}

      {trip.needsStart && (
        <StartDialog
          sampleDays={starterItinerary.days.length}
          sampleItems={starterItinerary.days.reduce((n, d) => n + d.items.length, 0)}
          onPick={trip.start}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <CatalogProvider>
      <Pages />
    </CatalogProvider>
  );
}
