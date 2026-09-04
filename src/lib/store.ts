import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import type { Day, Itinerary, ItineraryItem, Place } from '../types';
import { starterItinerary } from '../data/starterItinerary';
import { autoTimes } from './schedule';

import { TRIP_KEY as STORAGE_KEY } from './storageKeys';
const UNDO_DEPTH = 20;

export interface State {
  itinerary: Itinerary;
  /** Snapshots taken before destructive actions, newest last. */
  undo: { label: string; itinerary: Itinerary }[];
}

export type Action =
  | { type: 'load'; itinerary: Itinerary }
  | { type: 'reset' }
  | { type: 'renameTrip'; name: string }
  | { type: 'addDay' }
  | { type: 'removeDay'; dayId: string }
  | { type: 'updateDay'; dayId: string; patch: Partial<Pick<Day, 'label' | 'date' | 'stay'>> }
  | { type: 'moveDay'; from: number; to: number }
  | { type: 'addPlace'; dayId: string; place: Place; index?: number }
  | { type: 'addCustom'; dayId: string; title: string }
  | { type: 'removeItem'; dayId: string; itemId: string }
  | { type: 'updateItem'; dayId: string; itemId: string; patch: Partial<ItineraryItem> }
  | { type: 'moveItem'; fromDayId: string; toDayId: string; itemId: string; toIndex: number }
  | { type: 'retimeDay'; dayId: string; start: string; every: number }
  /**
   * Take a trip that arrived from somewhere else, keeping what is on screen on
   * the undo stack rather than discarding it.
   *
   * Distinct from `load`, which clears the stack, because that is right for a
   * first read and wrong for a change made on another device: whichever copy
   * loses a conflict has to be one keypress from coming back.
   */
  | { type: 'adopt'; itinerary: Itinerary; label: string }
  /**
   * Cut every stop's link to a place that has left the catalog, keeping the
   * stop. Used after deleting a place: the times, notes and costs on those
   * stops are the user's own work and none of it came from the catalog.
   */
  | { type: 'detachPlace'; placeId: string; title: string }
  | { type: 'undo' };

/**
 * A unique id for a day or a stop.
 *
 * This used to be a timestamp plus a counter, and the counter reset to zero on
 * every page load, so it was unique within one tab and nowhere else. Two
 * browsers adding their first day in the same millisecond minted the same id.
 * Unreachable while a trip lived in one browser; a silent merge collision the
 * moment the same trip is open in two places.
 *
 * randomUUID needs a secure context, which the deployed site and localhost both
 * are. The fallbacks are for anything else, and keep the same shape.
 */
export function newId(prefix: string) {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : randomHex();
  return `${prefix}-${uuid}`;
}

function randomHex(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // No crypto at all. Weaker, and still far better than a per-tab counter.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyItinerary(): Itinerary {
  return { name: 'My Trip', days: [{ id: newId('day'), label: 'Day 1', items: [] }] };
}

function withDays(state: State, days: Day[]): State {
  return { ...state, itinerary: { ...state.itinerary, days } };
}

function mapDay(state: State, dayId: string, fn: (day: Day) => Day): State {
  return withDays(
    state,
    state.itinerary.days.map((d) => (d.id === dayId ? fn(d) : d)),
  );
}

/** Push an undo point before a step that throws work away. */
function snapshot(state: State, label: string): State['undo'] {
  return [...state.undo, { label, itinerary: state.itinerary }].slice(-UNDO_DEPTH);
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'load':
      return { itinerary: action.itinerary, undo: [] };

    case 'reset':
      return { itinerary: emptyItinerary(), undo: snapshot(state, 'Reset') };

    case 'renameTrip':
      return { ...state, itinerary: { ...state.itinerary, name: action.name } };

    case 'addDay': {
      const day: Day = {
        id: newId('day'),
        label: `Day ${state.itinerary.days.length + 1}`,
        items: [],
      };
      return withDays(state, [...state.itinerary.days, day]);
    }

    case 'removeDay': {
      const day = state.itinerary.days.find((d) => d.id === action.dayId);
      const days = state.itinerary.days.filter((d) => d.id !== action.dayId);
      return {
        itinerary: { ...state.itinerary, days },
        undo: snapshot(state, `Removed ${day?.label ?? 'day'}`),
      };
    }

    case 'updateDay':
      return mapDay(state, action.dayId, (d) => ({ ...d, ...action.patch }));

    case 'moveDay': {
      const days = [...state.itinerary.days];
      const [moved] = days.splice(action.from, 1);
      if (!moved) return state;
      days.splice(action.to, 0, moved);
      return withDays(state, days);
    }

    case 'addPlace': {
      const { place } = action;
      const item: ItineraryItem = {
        id: newId('item'),
        placeId: place.id,
        estCostMin: place.priceMin,
        estCostMax: place.priceMax ?? place.priceMin,
      };
      return mapDay(state, action.dayId, (d) => {
        const items = [...d.items];
        items.splice(action.index ?? items.length, 0, item);
        return { ...d, items };
      });
    }

    case 'addCustom': {
      const item: ItineraryItem = { id: newId('item'), customTitle: action.title };
      return mapDay(state, action.dayId, (d) => ({ ...d, items: [...d.items, item] }));
    }

    case 'removeItem': {
      const day = state.itinerary.days.find((d) => d.id === action.dayId);
      const item = day?.items.find((i) => i.id === action.itemId);
      const next = mapDay(state, action.dayId, (d) => ({
        ...d,
        items: d.items.filter((i) => i.id !== action.itemId),
      }));
      return {
        ...next,
        undo: snapshot(state, `Removed ${item?.customTitle ?? 'item'}`.trim()),
      };
    }

    case 'updateItem':
      return mapDay(state, action.dayId, (d) => ({
        ...d,
        items: d.items.map((i) => (i.id === action.itemId ? { ...i, ...action.patch } : i)),
      }));

    case 'moveItem': {
      const from = state.itinerary.days.find((d) => d.id === action.fromDayId);
      const item = from?.items.find((i) => i.id === action.itemId);
      if (!item) return state;
      const without = state.itinerary.days.map((d) =>
        d.id === action.fromDayId
          ? { ...d, items: d.items.filter((i) => i.id !== action.itemId) }
          : d,
      );
      const days = without.map((d) => {
        if (d.id !== action.toDayId) return d;
        const items = [...d.items];
        items.splice(Math.max(0, Math.min(action.toIndex, items.length)), 0, item);
        return { ...d, items };
      });
      return withDays(state, days);
    }

    case 'retimeDay': {
      const day = state.itinerary.days.find((d) => d.id === action.dayId);
      if (!day || !day.items.length) return state;
      const times = autoTimes(day.items, action.start, action.every);
      const next = mapDay(state, action.dayId, (d) => ({
        ...d,
        items: d.items.map((i) => ({ ...i, startTime: times[i.id] ?? i.startTime })),
      }));
      return { ...next, undo: snapshot(state, `Retimed ${day.label}`) };
    }

    case 'adopt':
      return { itinerary: action.itinerary, undo: snapshot(state, action.label) };

    case 'detachPlace': {
      let touched = 0;
      const days = state.itinerary.days.map((d) => ({
        ...d,
        items: d.items.map((i) => {
          if (i.placeId !== action.placeId) return i;
          touched += 1;
          // The stop survives as a plain entry under the name it had. Dropping
          // placeId is what stops it rendering as a place that went missing.
          const { placeId: _gone, ...rest } = i;
          return { ...rest, customTitle: i.customTitle ?? action.title };
        }),
      }));
      if (!touched) return state;
      return {
        itinerary: { ...state.itinerary, days },
        undo: snapshot(state, `Detached ${action.title}`),
      };
    }

    case 'undo': {
      if (!state.undo.length) return state;
      const last = state.undo[state.undo.length - 1];
      return { itinerary: last.itinerary, undo: state.undo.slice(0, -1) };
    }

    default:
      return state;
  }
}

/**
 * Whether the stored trip has been read yet, and whether reading it worked.
 *
 * Three states rather than a boolean, because "there was nothing stored" and
 * "the read threw" both leave an empty reducer and must not be treated alike.
 * The first is a first visit and is safe to write over. The second means there
 * may well be a trip on disk that we simply could not see, and writing then
 * destroys it.
 */
export type StorageState = 'loading' | 'ready' | 'failed';

export function useItinerary() {
  const [state, dispatch] = useReducer(reducer, {
    itinerary: emptyItinerary(),
    undo: [],
  });
  const [storage, setStorage] = useState<StorageState>('loading');
  /** True until a first time visitor has said how they want to start. */
  const [needsStart, setNeedsStart] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    get<Itinerary>(STORAGE_KEY)
      .then((stored) => {
        if (!mounted.current) return;
        if (stored?.days) {
          dispatch({ type: 'load', itinerary: stored });
        } else if (stored !== undefined) {
          // Something is stored and it is not a trip. Absent is a first visit
          // and safe to write over; this is not. Offering the opening choice
          // here would let one click save a blank trip over whatever it is.
          console.error('The stored trip is not readable. Editing will not be saved.', stored);
          setStorage('failed');
          return;
        } else {
          // Nothing stored means nothing to restore, so ask rather than dropping
          // an eight day sample on someone and leaving them to guess whose it is.
          setNeedsStart(true);
        }
        setStorage('ready');
      })
      .catch((cause) => {
        if (!mounted.current) return;
        // Not silent. A trip may exist on disk that this browser cannot read,
        // and the app is about to run as though the trip were empty.
        console.error('Could not read the stored trip. Editing will not be saved.', cause);
        setStorage('failed');
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = useCallback((from: 'sample' | 'blank') => {
    dispatch({
      type: 'load',
      itinerary: from === 'sample' ? starterItinerary : emptyItinerary(),
    });
    setNeedsStart(false);
  }, []);

  // Write through on every change once the stored copy has been read, so the
  // first render never clobbers what is on disk. Held back until the opening
  // choice is made, so a visitor who reloads that screen still gets asked.
  //
  // 'ready' and not merely "not loading": a read that threw leaves the reducer
  // holding an empty trip, and saving that would overwrite whatever could not
  // be read. Refusing to write loses this session's edits, which is the smaller
  // loss of the two and the only one the user can be told about.
  useEffect(() => {
    if (storage !== 'ready' || needsStart) return;
    void set(STORAGE_KEY, state.itinerary).catch((cause) => {
      console.error('Could not save the trip to this browser.', cause);
    });
  }, [state.itinerary, storage, needsStart]);

  const usage = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const day of state.itinerary.days) {
      for (const item of day.items) {
        if (item.placeId) counts[item.placeId] = (counts[item.placeId] ?? 0) + 1;
      }
    }
    return counts;
  }, [state.itinerary]);

  const canUndo = state.undo.length > 0;
  const undoLabel = canUndo ? state.undo[state.undo.length - 1].label : '';
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);

  return {
    state,
    dispatch,
    // The screen can be drawn as soon as the read settles, either way. A
    // browser that cannot read its storage still gets a working app; it just
    // does not get a saved one.
    loaded: storage !== 'loading',
    storage,
    needsStart,
    start,
    usage,
    canUndo,
    undoLabel,
    undo,
  };
}
