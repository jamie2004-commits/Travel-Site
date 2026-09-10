import { describe, expect, it } from 'vitest';
import { groupItems, itemsOfKind, progress, type ChecklistItem } from './checklist';
import { parseBackup, summarise, type Backup } from './backup';

function item(patch: Partial<ChecklistItem> & { id: string }): ChecklistItem {
  return {
    kind: 'packing',
    text: 'Passport',
    done: false,
    addedAt: '2026-09-10T10:00:00.000Z',
    ...patch,
  };
}

describe('groupItems', () => {
  it('keeps headings in the order they were first used, not alphabetical', () => {
    // Somebody writes Documents first because that is what they think of
    // first. Sorting that under Clothes helps nobody.
    const out = groupItems([
      item({ id: 'a', group: 'Documents', addedAt: '2026-09-10T10:00:00.000Z' }),
      item({ id: 'b', group: 'Clothes', addedAt: '2026-09-10T10:01:00.000Z' }),
      item({ id: 'c', group: 'Documents', addedAt: '2026-09-10T10:02:00.000Z' }),
    ]);
    expect(out.map((g) => g.title)).toEqual(['Documents', 'Clothes']);
    expect(out[0].items.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('puts the unfiled bucket last however early something landed in it', () => {
    const out = groupItems([
      item({ id: 'loose', addedAt: '2026-09-10T09:00:00.000Z' }),
      item({ id: 'filed', group: 'Documents', addedAt: '2026-09-10T10:00:00.000Z' }),
    ]);
    expect(out.map((g) => g.title)).toEqual(['Documents', '']);
  });

  it('treats a blank or whitespace heading as unfiled rather than as its own', () => {
    const out = groupItems([
      item({ id: 'a', group: '   ' }),
      item({ id: 'b', group: '' }),
      item({ id: 'c' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('');
    expect(out[0].items).toHaveLength(3);
  });

  it('does not move a ticked item, so the list stays still under the finger', () => {
    const out = groupItems([
      item({ id: 'a', addedAt: '2026-09-10T10:00:00.000Z', done: true }),
      item({ id: 'b', addedAt: '2026-09-10T10:01:00.000Z' }),
      item({ id: 'c', addedAt: '2026-09-10T10:02:00.000Z', done: true }),
    ]);
    expect(out[0].items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('itemsOfKind and progress', () => {
  it('keeps the two lists apart', () => {
    const all = [
      item({ id: 'a', kind: 'packing' }),
      item({ id: 'b', kind: 'prep', text: 'Tell the bank' }),
      item({ id: 'c', kind: 'prep', text: 'Print the sheet', done: true }),
    ];
    expect(itemsOfKind(all, 'packing').map((i) => i.id)).toEqual(['a']);
    expect(progress(itemsOfKind(all, 'prep'))).toEqual({ done: 1, total: 2 });
  });

  it('is zero of zero on an empty list rather than dividing by nothing', () => {
    expect(progress([])).toEqual({ done: 0, total: 0 });
  });
});

/**
 * The lists have no server copy, so a backup is the only thing standing between
 * them and a cleared browser. storageKeys.ts calls a backup that looks fine and
 * is not the worst bug this feature could have, and the way that happens is a
 * new section being added to storage and never reaching the file.
 */
describe('a backup carries the lists', () => {
  it('accepts a file holding them and reports what is in it', () => {
    const file = JSON.stringify({
      format: 'itinerary-builder/backup',
      version: 1,
      savedAt: '2026-09-10T10:00:00.000Z',
      itinerary: { name: 'Hangzhou/Shanghai', days: [] },
      checklist: [item({ id: 'a' }), item({ id: 'b', done: true })],
    });

    const read = parseBackup(file);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    expect(read.backup.checklist).toHaveLength(2);
    const found = summarise(read.backup);
    expect(found.checklist).toBe(2);
    expect(found.hasChecklist).toBe(true);
  });

  it('tells a file with no lists apart from one carrying empty ones', () => {
    // The distinction the restore wording turns on: none keeps what is here,
    // empty removes it.
    const without = summarise({
      format: 'itinerary-builder/backup',
      version: 1,
      savedAt: '',
    } as Backup);
    expect(without.hasChecklist).toBe(false);
    expect(without.checklist).toBe(0);

    const empty = summarise({
      format: 'itinerary-builder/backup',
      version: 1,
      savedAt: '',
      checklist: [],
    } as Backup);
    expect(empty.hasChecklist).toBe(true);
    expect(empty.checklist).toBe(0);
  });

  it('refuses a file whose lists are not lists', () => {
    const file = JSON.stringify({
      format: 'itinerary-builder/backup',
      version: 1,
      savedAt: '',
      checklist: [1, 2, 3],
    });
    const read = parseBackup(file);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.message).toMatch(/packing and preparation/i);
  });

  it('still restores a trip from a backup written before the lists existed', () => {
    const old = JSON.stringify({
      format: 'itinerary-builder/backup',
      version: 1,
      savedAt: '2026-09-01T10:00:00.000Z',
      itinerary: { name: 'Older trip', days: [{ id: 'd0', label: 'Day 0', items: [] }] },
    });
    const read = parseBackup(old);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.backup.checklist).toBeUndefined();
  });
});
