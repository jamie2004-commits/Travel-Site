import { describe, expect, it } from 'vitest';
import {
  groupItems,
  isFoundSection,
  itemsOfKind,
  nameTaken,
  progress,
  sectionsOfKind,
  type ChecklistItem,
  type ChecklistSection,
} from './checklist';
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

function section(patch: Partial<ChecklistSection> & { id: string; name: string }): ChecklistSection {
  return {
    kind: 'packing',
    addedAt: '2026-09-10T10:00:00.000Z',
    ...patch,
  };
}

/** The names a page would draw, in the order it would draw them. */
const headings = (groups: ReturnType<typeof groupItems>) =>
  groups.map((g) => g.section?.name ?? null);

describe('groupItems', () => {
  it('draws sections in the order they were made, not alphabetically', () => {
    // Somebody makes Carry on bag first because that is the bag they pack
    // first. Sorting it under Checked luggage helps nobody.
    const groups = groupItems(
      [
        item({ id: 'a', group: 'Carry on bag' }),
        item({ id: 'b', group: 'Checked luggage' }),
      ],
      [
        section({ id: 's1', name: 'Carry on bag', addedAt: '2026-09-10T10:00:00.000Z' }),
        section({ id: 's2', name: 'Checked luggage', addedAt: '2026-09-10T10:05:00.000Z' }),
      ],
    );
    expect(headings(groups)).toEqual(['Carry on bag', 'Checked luggage']);
  });

  it('keeps a section that has nothing in it yet', () => {
    // The whole reason sections are stored rather than inferred: you make one
    // in order to put the next thing into it.
    const groups = groupItems([], [section({ id: 's1', name: 'Carry on bag' })]);
    expect(headings(groups)).toEqual(['Carry on bag']);
    expect(groups[0].items).toEqual([]);
  });

  it('puts the no-section bucket last however early something landed in it', () => {
    const groups = groupItems(
      [
        item({ id: 'loose', addedAt: '2026-09-10T09:00:00.000Z' }),
        item({ id: 'filed', group: 'Carry on bag', addedAt: '2026-09-10T10:00:00.000Z' }),
      ],
      [section({ id: 's1', name: 'Carry on bag' })],
    );
    expect(headings(groups)).toEqual(['Carry on bag', null]);
  });

  it('leaves out the no-section bucket when nothing is unfiled', () => {
    const groups = groupItems(
      [item({ id: 'a', group: 'Carry on bag' })],
      [section({ id: 's1', name: 'Carry on bag' })],
    );
    expect(headings(groups)).toEqual(['Carry on bag']);
  });

  it('rebuilds a heading that arrived on an item with no section behind it', () => {
    // What a second device sees: item headings reach the server, sections do
    // not. Without this the whole section reads as unfiled over there.
    const groups = groupItems([item({ id: 'a', group: 'Day bag' })], []);
    expect(headings(groups)).toEqual(['Day bag']);
    expect(isFoundSection(groups[0].section)).toBe(true);
  });

  it('marks a section that was really made here as editable', () => {
    const made = section({ id: 'sec-1', name: 'Carry on bag' });
    const groups = groupItems([], [made]);
    expect(isFoundSection(groups[0].section)).toBe(false);
  });

  it('treats a blank or whitespace heading as no section rather than its own', () => {
    const groups = groupItems(
      [item({ id: 'a', group: '   ' }), item({ id: 'b', group: '' }), item({ id: 'c' })],
      [],
    );
    expect(headings(groups)).toEqual([null]);
    expect(groups[0].items).toHaveLength(3);
  });

  it('does not move a ticked item, so the list stays still under the finger', () => {
    const groups = groupItems(
      [
        item({ id: 'a', addedAt: '2026-09-10T10:00:00.000Z', done: true }),
        item({ id: 'b', addedAt: '2026-09-10T10:01:00.000Z' }),
        item({ id: 'c', addedAt: '2026-09-10T10:02:00.000Z', done: true }),
      ],
      [],
    );
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the two lists apart when sections share a name across them', () => {
    const groups = groupItems(
      [item({ id: 'a', kind: 'packing', group: 'Later' })],
      [
        section({ id: 's1', kind: 'packing', name: 'Later' }),
        section({ id: 's2', kind: 'prep', name: 'Later' }),
      ],
    );
    // groupItems is handed one kind's sections by the caller; sectionsOfKind is
    // what does the splitting, and it is tested below.
    expect(sectionsOfKind([
      section({ id: 's1', kind: 'packing', name: 'Later' }),
      section({ id: 's2', kind: 'prep', name: 'Later' }),
    ], 'prep')).toHaveLength(1);
    expect(groups).toHaveLength(2);
  });
});

describe('nameTaken', () => {
  it('refuses a name already used in the same list, whatever the case', () => {
    const list = [section({ id: 's1', name: 'Carry on bag' })];
    expect(nameTaken(list, 'packing', 'carry ON bag')).toBe(true);
    expect(nameTaken(list, 'packing', '  Carry on bag  ')).toBe(true);
  });

  it('allows the same name in the other list', () => {
    const list = [section({ id: 's1', kind: 'packing', name: 'Later' })];
    expect(nameTaken(list, 'prep', 'Later')).toBe(false);
  });

  it('does not count a section against itself, so renaming the case works', () => {
    const list = [section({ id: 's1', name: 'Carry on bag' })];
    expect(nameTaken(list, 'packing', 'Carry On Bag', 's1')).toBe(false);
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
 * storageKeys.ts calls a backup that looks fine and is not the worst bug this
 * feature could have, and the way that happens is a new section of storage
 * being added and never reaching the file. The lists have two.
 */
describe('a backup carries the lists and their sections', () => {
  it('accepts a file holding both and reports what is in it', () => {
    const file = JSON.stringify({
      format: 'itinerary-builder/backup',
      version: 1,
      savedAt: '2026-09-10T10:00:00.000Z',
      itinerary: { name: 'Hangzhou/Shanghai', days: [] },
      checklist: [item({ id: 'a' }), item({ id: 'b', done: true })],
      checklistSections: [section({ id: 's1', name: 'Carry on bag' })],
    });

    const read = parseBackup(file);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    expect(read.backup.checklist).toHaveLength(2);
    expect(read.backup.checklistSections).toHaveLength(1);
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

    const empty = summarise({
      format: 'itinerary-builder/backup',
      version: 1,
      savedAt: '',
      checklist: [],
    } as Backup);
    expect(empty.hasChecklist).toBe(true);
    expect(empty.checklist).toBe(0);
  });

  it('refuses a file whose lists or sections are not lists', () => {
    const badItems = parseBackup(
      JSON.stringify({
        format: 'itinerary-builder/backup',
        version: 1,
        savedAt: '',
        checklist: [1, 2, 3],
      }),
    );
    expect(badItems.ok).toBe(false);
    if (!badItems.ok) expect(badItems.message).toMatch(/packing and preparation/i);

    const badSections = parseBackup(
      JSON.stringify({
        format: 'itinerary-builder/backup',
        version: 1,
        savedAt: '',
        checklistSections: ['Carry on bag'],
      }),
    );
    expect(badSections.ok).toBe(false);
    if (!badSections.ok) expect(badSections.message).toMatch(/sections/i);
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
    expect(read.backup.checklistSections).toBeUndefined();
  });
});
