import { describe, it, expect } from 'vitest';
import { BACKUP_VERSION, backupFilename, parseBackup, summarise, type Backup } from './backup';

/**
 * A backup is only worth anything if it reads back. These cover the round trip
 * and, more importantly, every way a file can be wrong: restoring replaces a
 * trip, so a file that is not ours has to be refused rather than half applied.
 */

const good: Backup = {
  format: 'itinerary-builder/backup',
  version: BACKUP_VERSION,
  savedAt: '2026-09-05T10:00:00.000Z',
  itinerary: {
    name: '杭州 Trip',
    days: [
      { id: 'd1', label: 'Day 1', items: [{ id: 'i1' }, { id: 'i2' }] },
      { id: 'd2', label: 'Day 2', items: [{ id: 'i3' }] },
    ],
  },
  expenses: [{ id: 'e1', category: 'food', label: 'Noodles', amount: 40, currency: 'CNY' }],
  rate: 5.45,
  userPlaces: [],
};

const parseOf = (v: unknown) => parseBackup(JSON.stringify(v));

describe('parseBackup', () => {
  it('reads back what was written', () => {
    const result = parseOf(good);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.backup).toEqual(good);
  });

  it('refuses a file that is not JSON', () => {
    const result = parseBackup('not json at all');
    expect(result).toMatchObject({ ok: false });
  });

  it('refuses JSON that is not an object', () => {
    expect(parseOf([1, 2, 3])).toMatchObject({ ok: false });
    expect(parseOf('a string')).toMatchObject({ ok: false });
    expect(parseOf(null)).toMatchObject({ ok: false });
  });

  it('refuses a file written by something else', () => {
    const result = parseOf({ ...good, format: 'some-other-app' });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toContain('not written by this app');
  });

  it('refuses a backup from a newer version, rather than guessing at it', () => {
    const result = parseOf({ ...good, version: BACKUP_VERSION + 1 });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toContain('newer version');
  });

  it('refuses a trip whose days are not a list', () => {
    expect(parseOf({ ...good, itinerary: { name: 'x', days: 'nope' } })).toMatchObject({
      ok: false,
    });
  });

  it('refuses expenses and places that are not lists', () => {
    expect(parseOf({ ...good, expenses: {} })).toMatchObject({ ok: false });
    expect(parseOf({ ...good, userPlaces: 'no' })).toMatchObject({ ok: false });
  });

  it('accepts a backup with sections missing, so an older file still restores', () => {
    const result = parseOf({
      format: 'itinerary-builder/backup',
      version: 1,
      savedAt: good.savedAt,
      itinerary: good.itinerary,
    });
    expect(result.ok).toBe(true);
  });
});

describe('parseBackup: files that would break the app if restored', () => {
  /**
   * The reason these exist. A malformed days array used to pass, get written to
   * storage, and then throw on the next render, because usage() walks
   * day.items. There is no error boundary, so that is a blank page, and a blank
   * page has no Restore button to undo the restore that caused it.
   */
  it('refuses days that are not day objects', () => {
    const result = parseOf({ ...good, itinerary: { name: 't', days: [1, 2, 3] } });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toContain('Day 1');
  });

  it('refuses a day with no items array, and says which day', () => {
    const days = [good.itinerary!.days[0], { id: 'd2', label: 'Day 2' }];
    const result = parseOf({ ...good, itinerary: { name: 't', days } });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toContain('Day 2');
  });

  it('refuses a null day', () => {
    expect(parseOf({ ...good, itinerary: { name: 't', days: [null] } })).toMatchObject({
      ok: false,
    });
  });

  it('refuses a stop that is not an object', () => {
    const days = [{ id: 'd1', label: 'Day 1', items: ['not a stop'] }];
    expect(parseOf({ ...good, itinerary: { name: 't', days } })).toMatchObject({ ok: false });
  });

  it('does not throw on a null itinerary, it refuses it', () => {
    let result: ReturnType<typeof parseBackup> | undefined;
    expect(() => {
      result = parseOf({ ...good, itinerary: null });
    }).not.toThrow();
    expect(result).toMatchObject({ ok: false });
  });

  it('refuses expenses and places whose entries are not objects', () => {
    expect(parseOf({ ...good, expenses: [1, 2] })).toMatchObject({ ok: false });
    expect(parseOf({ ...good, userPlaces: ['x'] })).toMatchObject({ ok: false });
  });

  it('refuses a file with no version rather than calling it "undefined"', () => {
    const { version, ...noVersion } = good;
    void version;
    const result = parseOf(noVersion);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).not.toContain('undefined');
  });

  it('still accepts a trip with no days in it, which is a real empty trip', () => {
    expect(parseOf({ ...good, itinerary: { name: 't', days: [] } })).toMatchObject({ ok: true });
  });
});

describe('summarise', () => {
  it('counts days, stops, expenses and places', () => {
    expect(summarise(good)).toMatchObject({
      days: 2,
      stops: 3,
      expenses: 1,
      places: 0,
      name: '杭州 Trip',
    });
  });

  it('tells an absent ledger apart from an empty one, which erase differently', () => {
    const absent = summarise({ format: 'itinerary-builder/backup', version: 1, savedAt: 'x' });
    const empty = summarise({ format: 'itinerary-builder/backup', version: 1, savedAt: 'x', expenses: [], userPlaces: [] });
    expect(absent.expenses).toBe(0);
    expect(empty.expenses).toBe(0);
    // The counts match; only these say which one erases what is here.
    expect(absent.hasExpenses).toBe(false);
    expect(empty.hasExpenses).toBe(true);
    expect(absent.hasPlaces).toBe(false);
    expect(empty.hasPlaces).toBe(true);
  });

  it('reports zeroes rather than throwing on an empty backup', () => {
    const empty: Backup = {
      format: 'itinerary-builder/backup',
      version: BACKUP_VERSION,
      savedAt: good.savedAt,
    };
    expect(summarise(empty)).toMatchObject({ days: 0, stops: 0, expenses: 0, places: 0 });
  });
});

describe('backupFilename', () => {
  it('keeps Chinese in the name', () => {
    expect(backupFilename('杭州 Trip')).toMatch(/^杭州-Trip-backup-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('falls back when the name leaves nothing usable', () => {
    expect(backupFilename('///')).toMatch(/^trip-backup-/);
    expect(backupFilename(undefined)).toMatch(/^trip-backup-/);
  });

  it('always ends .json, so the file picker will offer it back', () => {
    expect(backupFilename('anything')).toMatch(/\.json$/);
  });
});
