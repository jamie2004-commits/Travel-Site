import { useCallback, useEffect, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import type { StorageState } from './store';

const STORAGE_KEY = 'itinerary-builder/expenses/v1';
const RATE_KEY = 'itinerary-builder/expenses/rate/v1';

/**
 * Yuan to the Singapore dollar. A trip is paid for in two currencies — the
 * flights and the hotels from home in SGD, everything on the ground in RMB —
 * and a total is only a total in one of them. SGD wins because that is the
 * money the trip is actually being paid out of, so this is the rate everything
 * is carried back at. It is a starting point, not a quote: the real one is
 * whatever the card charged, and it is editable on the page.
 */
export const DEFAULT_RATE = 5.45;

export type Currency = 'SGD' | 'CNY';

export const CURRENCY_SYMBOLS: Record<Currency, string> = { SGD: 'S$', CNY: '¥' };

export type ExpenseCategory =
  | 'flights'
  | 'hotels'
  | 'food'
  | 'transport'
  | 'activities'
  | 'shopping'
  | 'other';

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'flights',
  'hotels',
  'food',
  'transport',
  'activities',
  'shopping',
  'other',
];

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  flights: 'Flights',
  hotels: 'Hotels',
  food: 'Food',
  transport: 'Transport',
  activities: 'Activities',
  shopping: 'Shopping',
  other: 'Other',
};

export const CATEGORY_MARKS: Record<ExpenseCategory, string> = {
  flights: '✈️',
  hotels: '\u{1F6CF}',
  food: '\u{1F35C}',
  transport: '\u{1F687}',
  activities: '\u{1F3AB}',
  shopping: '\u{1F6CD}',
  other: '\u{1F4CE}',
};

/**
 * Something actually paid for, as opposed to the per-stop estimates the
 * itinerary carries. A real spend has a date, a category and a number that is
 * already known, so none of it is a range and none of it is guessed.
 */
export interface Expense {
  id: string;
  /** ISO "2026-09-18". Free to be empty while a row is being typed. */
  date?: string;
  category: ExpenseCategory;
  label: string;
  /** Total paid, in the currency it was paid in. */
  amount: number;
  /**
   * What was handed over. Absent on rows written before the tracker knew
   * about SGD, which were all typed as yuan.
   */
  currency?: Currency;
  /** How many people that total covers, for the per person line. */
  people?: number;
  note?: string;
}

export interface CategoryTotal {
  category: ExpenseCategory;
  /** In Singapore dollars, like every other total on the page. */
  total: number;
  count: number;
}

let counter = 0;
function newId() {
  counter += 1;
  return `exp-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** "S$248.50", or "¥1,340" — yuan is never written with cents. */
export function money(amount: number, currency: Currency = 'SGD'): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return currency === 'SGD'
    ? `S$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `¥${Math.round(n).toLocaleString('en-US')}`;
}

/** One expense in Singapore dollars, whichever way it was paid. */
export function inSgd(expense: Expense, rate: number): number {
  const amount = Number.isFinite(expense.amount) ? expense.amount : 0;
  if ((expense.currency ?? 'CNY') === 'SGD') return amount;
  return rate > 0 ? amount / rate : 0;
}

export function toSgd(amount: number, currency: Currency, rate: number): number {
  if (currency === 'SGD') return amount;
  return rate > 0 ? amount / rate : 0;
}

/** The whole ledger in Singapore dollars. */
export function totalOf(expenses: Expense[], rate: number): number {
  return expenses.reduce((n, e) => n + inSgd(e, rate), 0);
}

/** Every category that has something in it, biggest spend first. */
export function byCategory(expenses: Expense[], rate: number): CategoryTotal[] {
  return EXPENSE_CATEGORIES.map((category) => {
    const rows = expenses.filter((e) => e.category === category);
    return { category, total: totalOf(rows, rate), count: rows.length };
  })
    .filter((c) => c.count > 0)
    .sort((a, b) => b.total - a.total);
}

/**
 * Newest first, and rows without a date sit at the top: an expense you have
 * just typed is the one you are still looking at.
 */
export function sortExpenses(expenses: Expense[]): Expense[] {
  return [...expenses].sort((a, b) => (b.date ?? '9999').localeCompare(a.date ?? '9999'));
}

/**
 * The recorded spend, kept beside the itinerary rather than inside it. The
 * trip is a plan and this is the receipt, so the two are stored apart: editing
 * one never rewrites the other, and clearing the plan does not throw away what
 * the trip actually cost.
 */
export function useExpenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [storage, setStorage] = useState<StorageState>('loading');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    Promise.all([get<Expense[]>(STORAGE_KEY), get<number>(RATE_KEY)])
      .then(([stored, storedRate]) => {
        if (!mounted.current) return;
        // Something is stored under this key and it is not a list of expenses.
        // Absent is a first visit and safe to write over; unreadable is not,
        // and the two are only distinguishable here. Treating this as empty
        // would save [] over whatever it actually is on the very next render.
        if (stored !== undefined && !Array.isArray(stored)) {
          console.error('The stored expenses are not a list. Editing will not be saved.', stored);
          setStorage('failed');
          return;
        }
        if (stored) setExpenses(stored);
        if (typeof storedRate === 'number' && storedRate > 0) setRate(storedRate);
        setStorage('ready');
      })
      .catch((cause) => {
        if (!mounted.current) return;
        console.error('Could not read the stored expenses. Editing will not be saved.', cause);
        setStorage('failed');
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  // Write through only once the stored copy has been read, so a first render
  // never saves an empty list over real rows. 'ready' and not merely "settled":
  // a read that threw leaves this list empty, and saving it would delete a
  // ledger that is on disk and merely unreadable. Same reasoning as the trip.
  useEffect(() => {
    if (storage !== 'ready') return;
    void set(STORAGE_KEY, expenses).catch((cause) => {
      console.error('Could not save expenses to this browser.', cause);
    });
  }, [expenses, storage]);

  useEffect(() => {
    if (storage !== 'ready') return;
    void set(RATE_KEY, rate).catch((cause) => {
      console.error('Could not save the exchange rate to this browser.', cause);
    });
  }, [rate, storage]);

  const add = useCallback((expense: Omit<Expense, 'id'>) => {
    setExpenses((list) => [...list, { ...expense, id: newId() }]);
  }, []);

  const update = useCallback((id: string, patch: Partial<Expense>) => {
    setExpenses((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const remove = useCallback((id: string) => {
    setExpenses((list) => list.filter((e) => e.id !== id));
  }, []);

  return { expenses, rate, setRate, loaded: storage !== 'loading', storage, add, update, remove };
}
