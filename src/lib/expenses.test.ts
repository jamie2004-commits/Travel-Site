import { describe, it, expect } from 'vitest';
import { DEFAULT_RATE, byCategory, inSgd, sortExpenses, totalOf, type Expense } from './expenses';

/**
 * The currency rules, which are about to become a schema decision.
 *
 * The load bearing one is the first test. A row written before the tracker knew
 * about SGD carries no currency and is yuan, per the note on the type. Declare
 * the Postgres column `not null default 'SGD'` and every one of those rows
 * silently becomes 5.45 times more expensive, with nothing to notice it.
 */

const e = (over: Partial<Expense> = {}): Expense => ({
  id: 'e',
  category: 'food',
  label: '',
  amount: 100,
  ...over,
});

describe('inSgd', () => {
  it('treats a row with no currency as yuan', () => {
    expect(inSgd(e({ amount: 100 }), 5.45)).toBeCloseTo(18.35, 2);
  });

  it('leaves a row already in SGD alone', () => {
    expect(inSgd(e({ amount: 100, currency: 'SGD' }), 5.45)).toBe(100);
  });

  it('converts a yuan row', () => {
    expect(inSgd(e({ amount: 545, currency: 'CNY' }), 5.45)).toBeCloseTo(100, 6);
  });

  it('returns zero at a rate of zero rather than dividing by it', () => {
    expect(inSgd(e({ amount: 100, currency: 'CNY' }), 0)).toBe(0);
  });

  it('treats a non-finite amount as zero, so one bad row cannot poison a total', () => {
    expect(inSgd(e({ amount: Number.NaN, currency: 'SGD' }), 5.45)).toBe(0);
    expect(inSgd(e({ amount: Number.POSITIVE_INFINITY, currency: 'SGD' }), 5.45)).toBe(0);
  });
});

describe('totalOf', () => {
  it('is zero for an empty ledger', () => {
    expect(totalOf([], DEFAULT_RATE)).toBe(0);
  });

  it('adds the two currencies into one number', () => {
    const rows = [e({ amount: 100, currency: 'SGD' }), e({ amount: 545, currency: 'CNY' })];
    expect(totalOf(rows, 5.45)).toBeCloseTo(200, 6);
  });
});

describe('byCategory', () => {
  it('leaves out categories with nothing in them', () => {
    const rows = [e({ category: 'food', amount: 100, currency: 'SGD' })];
    expect(byCategory(rows, 5.45).map((c) => c.category)).toEqual(['food']);
  });

  it('puts the biggest spend first', () => {
    const rows = [
      e({ id: '1', category: 'food', amount: 10, currency: 'SGD' }),
      e({ id: '2', category: 'flights', amount: 900, currency: 'SGD' }),
      e({ id: '3', category: 'hotels', amount: 300, currency: 'SGD' }),
    ];
    expect(byCategory(rows, 5.45).map((c) => c.category)).toEqual(['flights', 'hotels', 'food']);
  });
});

describe('sortExpenses', () => {
  it('is newest first, with undated rows at the top', () => {
    const rows = [
      e({ id: 'old', date: '2026-09-01' }),
      e({ id: 'new', date: '2026-09-20' }),
      e({ id: 'typing' }),
    ];
    expect(sortExpenses(rows).map((r) => r.id)).toEqual(['typing', 'new', 'old']);
  });

  it('does not mutate what it was given', () => {
    const rows = [e({ id: 'a', date: '2026-09-01' }), e({ id: 'b', date: '2026-09-20' })];
    sortExpenses(rows);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
