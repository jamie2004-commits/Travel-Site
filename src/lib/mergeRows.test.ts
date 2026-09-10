import { describe, it, expect } from 'vitest';
import { mergeRows } from './mergeRows';

interface Row {
  id: string;
  label: string;
  done?: boolean;
}

const r = (id: string, label: string, done = false): Row => ({ id, label, done });
const ids = (rows: Row[]) => rows.map((x) => x.id).sort();
const merge = (local: Row[], server: Row[], pushed: Row[] | null) =>
  mergeRows(local, server, pushed, (x) => x.id);

describe('mergeRows', () => {
  it('keeps a row added here that the server has never seen', () => {
    const out = merge([r('a', 'Passport'), r('b', 'Adapter')], [r('a', 'Passport')], [
      r('a', 'Passport'),
    ]);
    expect(ids(out.rows)).toEqual(['a', 'b']);
    expect(ids(out.added)).toEqual(['b']);
    expect(out.removed).toEqual([]);
  });

  it('keeps a row added elsewhere that this device has never seen', () => {
    const out = merge([r('a', 'Passport')], [r('a', 'Passport'), r('c', 'Sunscreen')], [
      r('a', 'Passport'),
    ]);
    expect(ids(out.rows)).toEqual(['a', 'c']);
    expect(out.added).toEqual([]);
  });

  /**
   * The whole point of the third copy. Both of these rows are "here and not on
   * the server", and without lastPushed they are indistinguishable.
   */
  it('drops a row deleted elsewhere but keeps one added here, in the same pass', () => {
    const out = merge(
      [r('a', 'Passport'), r('b', 'Adapter'), r('new', 'Melatonin')],
      [r('a', 'Passport')],
      [r('a', 'Passport'), r('b', 'Adapter')],
    );
    expect(ids(out.rows)).toEqual(['a', 'new']);
    expect(ids(out.removed)).toEqual(['b']);
    expect(ids(out.added)).toEqual(['new']);
  });

  it('takes the server copy of a row this device has not touched', () => {
    const out = merge([r('a', 'Passport', false)], [r('a', 'Passport', true)], [
      r('a', 'Passport', false),
    ]);
    expect(out.rows[0].done).toBe(true);
    expect(out.added).toEqual([]);
  });

  it('keeps an unpushed edit made here over an older server copy', () => {
    const out = merge([r('a', 'Passport', true)], [r('a', 'Passport', false)], [
      r('a', 'Passport', false),
    ]);
    expect(out.rows[0].done).toBe(true);
    expect(ids(out.added)).toEqual(['a']);
  });

  /**
   * No record of ever having agreed. Every absence is unexplainable, so nothing
   * may be deleted on a guess: a duplicate is recoverable by hand and a deleted
   * row is not.
   */
  it('deletes nothing when there is no record of a previous sync', () => {
    const out = merge([r('a', 'Passport'), r('b', 'Adapter')], [r('c', 'Sunscreen')], null);
    expect(ids(out.rows)).toEqual(['a', 'b', 'c']);
    expect(out.removed).toEqual([]);
    expect(ids(out.added)).toEqual(['a', 'b']);
  });

  it('is a no-op when all three agree', () => {
    const rows = [r('a', 'Passport'), r('b', 'Adapter')];
    const out = merge(rows, rows, rows);
    expect(ids(out.rows)).toEqual(['a', 'b']);
    expect(out.added).toEqual([]);
    expect(out.removed).toEqual([]);
  });

  it('accepts a deletion made elsewhere on a row this device never changed', () => {
    const out = merge([r('a', 'Passport'), r('b', 'Adapter')], [r('a', 'Passport')], [
      r('a', 'Passport'),
      r('b', 'Adapter'),
    ]);
    expect(ids(out.rows)).toEqual(['a']);
    expect(ids(out.removed)).toEqual(['b']);
  });

  it('orders on the server so two devices converge rather than diverging', () => {
    const out = merge(
      [r('local', 'Mine')],
      [r('x', 'First'), r('y', 'Second')],
      [],
    );
    expect(out.rows.map((x) => x.id)).toEqual(['x', 'y', 'local']);
  });

  it('handles both sides empty', () => {
    const out = merge([], [], []);
    expect(out.rows).toEqual([]);
    expect(out.added).toEqual([]);
    expect(out.removed).toEqual([]);
  });

  /**
   * An empty server with a real lastPushed means everything really was deleted
   * elsewhere. Painful, and still the correct reading: the alternative is that
   * one device can never accept a clearing made on another.
   */
  it('accepts everything having been deleted elsewhere', () => {
    const out = merge([r('a', 'Passport')], [], [r('a', 'Passport')]);
    expect(out.rows).toEqual([]);
    expect(ids(out.removed)).toEqual(['a']);
  });
});
