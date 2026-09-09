import { describe, expect, it } from 'vitest';
import { toHtml } from './export';
import { emptyCatalog } from './catalog';
import type { Expense } from './expenses';
import type { Itinerary } from '../types';

/**
 * The exported page is the one thing here nobody sees until it is already in
 * somebody's inbox: it is generated, downloaded and opened somewhere else, so a
 * mistake in it does not show up in the app at all. Section order is exactly
 * that kind of mistake, which is why it is pinned here rather than trusted.
 */

const trip: Itinerary = {
  name: 'Hangzhou/Shanghai',
  days: [
    {
      id: 'd0',
      label: 'Departure night',
      startsAtZero: true,
      stay: { name: 'Overnight flight' },
      items: [
        {
          id: 'd0-01',
          customTitle: 'Flight to Shanghai Pudong',
          startTime: '23:45',
          travel: { mode: 'flight', number: 'HO1576', from: 'Singapore Changi T2', arrive: '05:15' },
        },
      ],
    },
    {
      id: 'd1',
      label: 'Arrive, West Lake',
      stay: { name: 'Wanda Realm Hangzhou' },
      items: [{ id: 'd1-01', customTitle: 'Land at Pudong', startTime: '05:15' }],
    },
  ],
};

const ledger: { expenses: Expense[]; rate: number } = {
  rate: 5.4,
  expenses: [{ id: 'e1', label: 'Airport coach', amount: 120, currency: 'CNY', category: 'transport' }],
};

/** Where each block starts in the document, or -1 when it is not there. */
function order(html: string) {
  return {
    firstDay: html.indexOf('<section class="day" id="d0">'),
    travel: html.indexOf('id="travel"'),
    hotels: html.indexOf('id="hotels"'),
    spending: html.indexOf('id="spending"'),
  };
}

describe('toHtml section order', () => {
  it('opens on the first day, so Day 0 is on screen without scrolling', () => {
    const at = order(toHtml(trip, emptyCatalog, ledger));

    // The point of the ordering. Getting there and Where you are staying are
    // reference lists you consult, not the thing you opened the page to read,
    // and they used to sit above every day and push Day 0 below the fold.
    expect(at.firstDay).toBeGreaterThan(-1);
    expect(at.firstDay).toBeLessThan(at.travel);
    expect(at.travel).toBeLessThan(at.hotels);
    expect(at.hotels).toBeLessThan(at.spending);
  });

  it('puts the days in the document in the order the nav lists them', () => {
    const html = toHtml(trip, emptyCatalog, ledger);
    const nav = html.slice(html.indexOf('<nav>'), html.indexOf('</nav>'));
    const navOrder = [...nav.matchAll(/href="#(\w+)"/g)].map((m) => m[1]);

    // A nav that reads days, Travel, Hotels, Spending against a document that
    // read Travel, Hotels, days, Spending was the state before this change.
    // Two orders for one page is a bug whichever one you call correct.
    expect(navOrder).toEqual(['d0', 'd1', 'travel', 'hotels', 'spending']);

    const positions = navOrder.map((id) => html.indexOf(`id="${id}"`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('leaves out the blocks a trip has nothing for', () => {
    const bare: Itinerary = {
      name: 'Nothing booked',
      days: [{ id: 'd0', label: 'Day one', items: [] }],
    };
    const at = order(toHtml(bare, emptyCatalog));

    expect(at.firstDay).toBeGreaterThan(-1);
    expect(at.travel).toBe(-1);
    expect(at.hotels).toBe(-1);
    expect(at.spending).toBe(-1);
  });
});
