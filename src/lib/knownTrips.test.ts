import { describe, it, expect } from 'vitest';
import { describeTrip, tripChoices, type KnownTrip } from './knownTrips';
import { buildCatalog } from './catalog';
import type { Itinerary, Place, District, Day } from '../types';

/**
 * The list the start dialog offers.
 *
 * It was empty in the one case it existed for. The dialog only appears when
 * this browser has no stored trip, the local list of known trips lives in that
 * same storage, so the machine that owned the trip was the machine that could
 * not offer it. These cover the merge that fixed it.
 */

const place = (id: string, city: 'shanghai' | 'hangzhou'): Place => ({
  id,
  nameZh: id,
  nameEn: id,
  city,
  district: `${city}-other`,
  category: 'food',
  description: '',
  tags: [],
});

const district = (city: 'shanghai' | 'hangzhou'): District => ({
  id: `${city}-other`,
  city,
  nameZh: '其他',
  nameEn: 'Elsewhere',
  accentColor: '#000',
});

const catalog = buildCatalog(
  [place('a', 'shanghai'), place('b', 'hangzhou')],
  [district('shanghai'), district('hangzhou')],
  'bundled',
);

const day = (
  id: string,
  date: string | undefined,
  items: Day['items'],
): Day => ({ id, label: id.toUpperCase(), date, items });

const trip = (days: Day[]): Itinerary => ({ name: 'Whatever I typed', days });

const known = (over: Partial<KnownTrip> = {}): KnownTrip => ({
  code: 'k1',
  label: 'A trip from elsewhere',
  lastOpened: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('describeTrip', () => {
  it('names the cities and the month, not the trip name and the exact day', () => {
    const it0 = trip([
      day('d1', '2026-09-17', [{ id: 'i1', placeId: 'a' }]),
      day('d2', '2026-09-21', [{ id: 'i2', placeId: 'b' }]),
    ]);
    expect(describeTrip(it0, catalog)).toBe('Shanghai and Hangzhou, September 2026');
  });

  it('says both months when the trip runs across one', () => {
    const it0 = trip([
      day('d1', '2026-09-28', [{ id: 'i1', placeId: 'a' }]),
      day('d2', '2026-10-02', []),
    ]);
    expect(describeTrip(it0, catalog)).toBe('Shanghai, September to October 2026');
  });

  it('falls back to the trip name when no stop resolves to a city', () => {
    const it0 = trip([day('d1', '2026-09-17', [{ id: 'i1' }])]);
    expect(describeTrip(it0, catalog)).toBe('Whatever I typed, September 2026');
  });

  it('survives a trip with no dates at all', () => {
    expect(describeTrip(trip([day('d1', undefined, [{ id: 'i1', placeId: 'a' }])]), catalog)).toBe(
      'Shanghai',
    );
  });
});

describe('tripChoices', () => {
  const owned = [
    {
      code: 'own-1',
      label: 'China 2026, 17 Sep 2026',
      itinerary: trip([day('d1', '2026-09-17', [{ id: 'i1', placeId: 'a' }])]),
    },
  ];

  it('describes an owned trip from its document, not from the stored label', () => {
    const [first] = tripChoices(owned, [], catalog);
    expect(first.label).toBe('Shanghai, September 2026');
    expect(first.mine).toBe(true);
  });

  it('falls back to the stored label when the document did not come back', () => {
    const [first] = tripChoices([{ ...owned[0], itinerary: null }], [], catalog);
    expect(first.label).toBe('China 2026, 17 Sep 2026');
  });

  it('keeps a trip this browser was only given a code for', () => {
    const list = tripChoices(owned, [known()], catalog);
    expect(list.map((t) => t.code)).toEqual(['own-1', 'k1']);
    expect(list[1].mine).toBe(false);
  });

  it('lists a trip once when it is both owned and remembered locally', () => {
    const list = tripChoices(owned, [known({ code: 'own-1', label: 'stale local label' })], catalog);
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('Shanghai, September 2026');
  });

  it('is empty on a browser that owns nothing and has been given nothing', () => {
    expect(tripChoices([], [], catalog)).toEqual([]);
  });

  it('drops a row with no code, which could never be opened', () => {
    expect(tripChoices([{ ...owned[0], code: '' }], [], catalog)).toEqual([]);
  });
});
