import { describe, it, expect } from 'vitest';
import { describeTrip } from './tripLabels';
import { buildCatalog } from './catalog';
import type { Itinerary, Place, District, Day } from '../types';

/**
 * How a trip names itself in the picker.
 *
 * The cities tell two trips apart at a glance and the month places them; the
 * name someone typed at the top of the sheet is the fallback for a trip whose
 * stops resolve to no city at all.
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
