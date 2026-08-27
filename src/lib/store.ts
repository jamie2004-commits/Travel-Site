import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import type { Day, Itinerary, ItineraryItem, Place } from '../types';
import { starterItinerary } from '../data/starterItinerary';
import { DEFAULT_DURATION } from './format';

const STORAGE_KEY = 'itinerary-builder/v1';
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
  | { type: 'updateDay'; dayId: string; patch: Partial<Pick<Day, 'label' | 'date'>> }
  | { type: 'moveDay'; from: number; to: number }
  | { type: 'addPlace'; dayId: string; place: Place; index?: number }
  | { type: 'addCustom'; dayId: string; title: string }
  | { type: 'removeItem'; dayId: string; itemId: string }
  | { type: 'updateItem'; dayId: string; itemId: string; patch: Partial<ItineraryItem> }
  | { type: 'moveItem'; fromDayId: string; toDayId: string; itemId: string; toIndex: number }
  | { type: 'undo' };

let counter = 0;
export function newId(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function emptyItinerary(): Itinerary {
  return { name: '我的行程', days: [{ id: newId('day'), label: 'Day 1', items: [] }] };
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
      return { itinerary: emptyItinerary(), undo: snapshot(state, '清空行程 Reset') };

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
        undo: snapshot(state, `删除 ${day?.label ?? 'day'}`),
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
        durationMinutes: place.durationMinutes ?? DEFAULT_DURATION[place.category],
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
        undo: snapshot(state, `删除 ${item?.customTitle ?? 'item'}`.trim()),
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

    case 'undo': {
      if (!state.undo.length) return state;
      const last = state.undo[state.undo.length - 1];
      return { itinerary: last.itinerary, undo: state.undo.slice(0, -1) };
    }

    default:
      return state;
  }
}

export function useItinerary() {
  const [state, dispatch] = useReducer(reducer, {
    itinerary: starterItinerary,
    undo: [],
  });
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    get<Itinerary>(STORAGE_KEY)
      .then((stored) => {
        if (!mounted.current) return;
        if (stored?.days) dispatch({ type: 'load', itinerary: stored });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      mounted.current = false;
    };
  }, []);

  // Write through on every change once the stored copy has been read, so the
  // first render never clobbers what is on disk.
  useEffect(() => {
    if (!loaded) return;
    void set(STORAGE_KEY, state.itinerary).catch(() => {});
  }, [state.itinerary, loaded]);

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

  return { state, dispatch, loaded, usage, canUndo, undoLabel, undo };
}
