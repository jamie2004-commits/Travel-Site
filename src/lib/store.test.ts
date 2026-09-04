import { describe, it, expect } from 'vitest';
import { reducer, newId, emptyItinerary, type State } from './store';
import type { Itinerary, Place } from '../types';

/**
 * The reducer, which is pure and exported and had never been run outside a
 * browser. These are not "does addDay add a day" tests. They pin the behaviour
 * the sync layer is about to collide with: what clears the undo stack, what
 * does not push one, and what happens when an action names something gone.
 */

const trip = (days: Itinerary['days']): Itinerary => ({ name: 'Trip', days });
const state = (days: Itinerary['days'], undo: State['undo'] = []): State => ({
  itinerary: trip(days),
  undo,
});

const place = (id: string, priceMin?: number, priceMax?: number): Place => ({
  id,
  nameZh: '地方',
  nameEn: 'Place',
  city: 'hangzhou',
  district: 'xihu',
  category: 'activity',
  description: '',
  tags: [],
  priceMin,
  priceMax,
});

describe('newId', () => {
  it('does not repeat, even in the same millisecond', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId('day')));
    expect(ids.size).toBe(500);
  });

  it('keeps the prefix', () => {
    expect(newId('item').startsWith('item-')).toBe(true);
  });
});

describe('reducer: the undo stack', () => {
  it('load clears it, which is why a remote change must not go through load', () => {
    const before = state([], [{ label: 'something', itinerary: trip([]) }]);
    const after = reducer(before, { type: 'load', itinerary: trip([]) });
    expect(after.undo).toEqual([]);
  });

  it('caps at 20 and drops the oldest', () => {
    let s = state([{ id: 'd1', label: 'Day 1', items: [] }]);
    for (let i = 0; i < 25; i += 1) {
      s = reducer(s, { type: 'removeDay', dayId: 'nothing' });
    }
    expect(s.undo).toHaveLength(20);
  });

  it('does not push an undo point for a move, so undo never undoes a drag', () => {
    const s = state([
      { id: 'd1', label: 'Day 1', items: [{ id: 'i1' }, { id: 'i2' }] },
    ]);
    const after = reducer(s, {
      type: 'moveItem',
      fromDayId: 'd1',
      toDayId: 'd1',
      itemId: 'i1',
      toIndex: 1,
    });
    expect(after.undo).toEqual([]);
    expect(after.itinerary.days[0].items.map((i) => i.id)).toEqual(['i2', 'i1']);
  });

  it('undo restores the trip and pops exactly one entry', () => {
    const older = trip([{ id: 'old', label: 'Old', items: [] }]);
    const s = state([{ id: 'new', label: 'New', items: [] }], [
      { label: 'a', itinerary: trip([]) },
      { label: 'b', itinerary: older },
    ]);
    const after = reducer(s, { type: 'undo' });
    expect(after.itinerary).toEqual(older);
    expect(after.undo).toHaveLength(1);
  });

  it('undo on an empty stack changes nothing', () => {
    const s = state([{ id: 'd1', label: 'Day 1', items: [] }]);
    expect(reducer(s, { type: 'undo' })).toBe(s);
  });
});

describe('reducer: guards against ids that are not there', () => {
  it('moveDay with an out of range index returns the state unchanged', () => {
    const s = state([{ id: 'd1', label: 'Day 1', items: [] }]);
    expect(reducer(s, { type: 'moveDay', from: 9, to: 0 })).toBe(s);
  });

  it('moveItem with an unknown item returns the state unchanged', () => {
    const s = state([{ id: 'd1', label: 'Day 1', items: [] }]);
    expect(
      reducer(s, { type: 'moveItem', fromDayId: 'd1', toDayId: 'd1', itemId: 'nope', toIndex: 0 }),
    ).toBe(s);
  });

  it('moveItem clamps an index past the end', () => {
    const s = state([
      { id: 'd1', label: 'Day 1', items: [{ id: 'i1' }] },
      { id: 'd2', label: 'Day 2', items: [] },
    ]);
    const after = reducer(s, {
      type: 'moveItem',
      fromDayId: 'd1',
      toDayId: 'd2',
      itemId: 'i1',
      toIndex: 99,
    });
    expect(after.itinerary.days[1].items.map((i) => i.id)).toEqual(['i1']);
    expect(after.itinerary.days[0].items).toEqual([]);
  });

  it('retimeDay on an empty day changes nothing and pushes no undo', () => {
    const s = state([{ id: 'd1', label: 'Day 1', items: [] }]);
    expect(reducer(s, { type: 'retimeDay', dayId: 'd1', start: '09:00', every: 60 })).toBe(s);
  });
});

describe('reducer: addPlace', () => {
  it('carries the price across as the cost estimate', () => {
    const s = state([{ id: 'd1', label: 'Day 1', items: [] }]);
    const after = reducer(s, { type: 'addPlace', dayId: 'd1', place: place('p', 40, 80) });
    expect(after.itinerary.days[0].items[0]).toMatchObject({
      placeId: 'p',
      estCostMin: 40,
      estCostMax: 80,
    });
  });

  it('falls back to the low price when there is no high one', () => {
    const s = state([{ id: 'd1', label: 'Day 1', items: [] }]);
    const after = reducer(s, { type: 'addPlace', dayId: 'd1', place: place('p', 40) });
    expect(after.itinerary.days[0].items[0].estCostMax).toBe(40);
  });

  it('inserts at the index given rather than appending', () => {
    const s = state([{ id: 'd1', label: 'Day 1', items: [{ id: 'i1' }, { id: 'i2' }] }]);
    const after = reducer(s, { type: 'addPlace', dayId: 'd1', place: place('p'), index: 1 });
    expect(after.itinerary.days[0].items.map((i) => i.placeId ?? i.id)).toEqual(['i1', 'p', 'i2']);
  });
});

describe('emptyItinerary', () => {
  it('is one empty day, so a blank start is not a blank screen', () => {
    const it = emptyItinerary();
    expect(it.days).toHaveLength(1);
    expect(it.days[0].items).toEqual([]);
  });
});
