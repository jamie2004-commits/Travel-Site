import { describe, it, expect } from 'vitest';
import { dayNumberOffset, lastDayNumber, startsAtZero } from './days';
import type { Day } from '../types';

/**
 * Whether the trip opens on a departure eve. Cheap to test and expensive to get
 * wrong: the answer shifts every day number on the sheet, in both exports, and
 * every "Night N" label on the hotels, which take the same offset.
 */

const day = (items: Day['items']): Day => ({ id: 'd', label: 'Day', items });

const flight = (startTime: string, arrive: string): Day['items'][number] => ({
  id: 'f',
  startTime,
  travel: { mode: 'flight', arrive },
});

describe('startsAtZero', () => {
  it('is false with no days at all', () => {
    expect(startsAtZero([])).toBe(false);
  });

  it('is false when the first day is empty', () => {
    expect(startsAtZero([day([])])).toBe(false);
  });

  it('is false when the first day has no travel on it', () => {
    expect(startsAtZero([day([{ id: 'a', startTime: '09:00' }])])).toBe(false);
  });

  it('is true when the first day is nothing but the journey', () => {
    expect(startsAtZero([day([flight('23:45', '05:15')])])).toBe(true);
  });

  it('is true when a leg is still in the air at midnight', () => {
    const d = day([{ id: 'dinner', startTime: '19:00' }, flight('23:45', '05:15')]);
    expect(startsAtZero([d])).toBe(true);
  });

  it('is false when the day has other things and the leg lands the same day', () => {
    const d = day([{ id: 'lunch', startTime: '12:00' }, flight('14:00', '16:30')]);
    expect(startsAtZero([d])).toBe(false);
  });

  it('reads only the first day, not later ones', () => {
    const days = [day([{ id: 'a', startTime: '09:00' }]), day([flight('23:45', '05:15')])];
    expect(startsAtZero(days)).toBe(false);
  });
});

describe('dayNumberOffset', () => {
  it('is 1 for an ordinary trip, so the first day is Day 1', () => {
    expect(dayNumberOffset([day([{ id: 'a' }])])).toBe(1);
  });

  it('is 0 when the trip opens on a departure eve, so the landing day is Day 1', () => {
    expect(dayNumberOffset([day([flight('23:45', '05:15')]), day([])])).toBe(0);
  });
});

describe('lastDayNumber', () => {
  it('counts an ordinary trip from one', () => {
    expect(lastDayNumber([day([]), day([]), day([])])).toBe(3);
  });

  it('counts a departure eve as day zero, so the trip reads one day shorter', () => {
    const days = [day([flight('23:45', '05:15')]), day([]), day([])];
    expect(lastDayNumber(days)).toBe(2);
  });
});
