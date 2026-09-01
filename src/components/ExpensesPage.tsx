import { useMemo, useState } from 'react';
import type { Itinerary } from '../types';
import { sumCosts } from '../lib/format';
import type { CostSum } from '../lib/format';
import { dayNumberOffset } from '../lib/days';
import {
  CATEGORY_LABELS,
  CATEGORY_MARKS,
  EXPENSE_CATEGORIES,
  byCategory,
  sortExpenses,
  totalOf,
  useExpenses,
} from '../lib/expenses';
import type { Expense, ExpenseCategory } from '../lib/expenses';

interface Props {
  itinerary: Itinerary;
  onSheet: () => void;
  onEdit: () => void;
  onActivities: () => void;
}

const money = (n: number) => `¥${Math.round(n).toLocaleString('en-US')}`;

function range(sum: CostSum): string {
  if (!sum.known) return 'No estimate';
  return sum.min === sum.max ? money(sum.min) : `${money(sum.min)}–${money(sum.max)}`;
}

/** "2026-09-17" to "17 / 09". Parsed as a plain date, no timezone in play. */
function dayNumber(date?: string, fallback?: string) {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]} / ${m[2]}` : (fallback ?? '');
}

/** A blank row, dated to the first day of the trip so most entries need no typing. */
function blankDraft(date?: string): Omit<Expense, 'id'> {
  return { date: date ?? '', category: 'food', label: '', amount: 0, people: 1, note: '' };
}

/**
 * What the trip actually cost, which is a different question from what it was
 * estimated to cost and so lives on a page of its own. The itinerary's own
 * numbers are per stop guesses with no flights or hotels in them; this is
 * receipts, in the categories money really leaves in.
 */
export default function ExpensesPage({ itinerary, onSheet, onEdit, onActivities }: Props) {
  const { expenses, loaded, add, remove } = useExpenses();
  const days = itinerary.days;
  const dayOffset = dayNumberOffset(days);
  const firstDate = days.find((d) => d.date)?.date;
  const [draft, setDraft] = useState<Omit<Expense, 'id'>>(() => blankDraft(firstDate));
  const [showPlan, setShowPlan] = useState(false);

  const rows = useMemo(() => sortExpenses(expenses), [expenses]);
  const totals = useMemo(() => byCategory(expenses), [expenses]);
  const spent = totalOf(expenses);
  const heads = Math.max(1, ...expenses.map((e) => e.people ?? 1));
  const planned = sumCosts(days.flatMap((d) => d.items));

  const canSave = draft.label.trim().length > 0 && Number(draft.amount) > 0;

  const save = () => {
    if (!canSave) return;
    add({
      ...draft,
      label: draft.label.trim(),
      amount: Number(draft.amount),
      people: Math.max(1, Number(draft.people) || 1),
      note: draft.note?.trim() || undefined,
      date: draft.date || undefined,
    });
    setDraft((d) => blankDraft(d.date || firstDate));
  };

  return (
    <div className="sheet">
      <header>
        <div className="wrap">
          <div className="eyebrow">Expenses · what the trip actually cost</div>
          <h1>Spending</h1>
          <div className="sub">Flights, hotels, food and everything else, as you pay for it</div>

          <dl className="meta">
            <div>
              <dt>Recorded</dt>
              <dd>{money(spent)}</dd>
            </div>
            <div>
              <dt>Per person</dt>
              <dd>{money(spent / heads)}</dd>
            </div>
            <div>
              <dt>Entries</dt>
              <dd>{expenses.length}</dd>
            </div>
          </dl>

          <div className="heroactions">
            <button type="button" className="edit ghost" onClick={onSheet}>
              Itinerary
            </button>
            <button type="button" className="edit ghost" onClick={onEdit}>
              Edit this trip
            </button>
            <button type="button" className="edit ghost" onClick={onActivities}>
              Activities
            </button>
            <button type="button" className="edit ghost" onClick={() => window.print()}>
              Print
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="expadd">
          <h2>
            Record an expense
            <span className="en">One line per payment, in yuan</span>
          </h2>

          <form
            className="expform"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label>
              <span className="eyebrow">Date</span>
              <input
                type="date"
                className="field"
                value={draft.date ?? ''}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </label>
            <label>
              <span className="eyebrow">Category</span>
              <select
                className="field"
                value={draft.category}
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value as ExpenseCategory })
                }
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="expwide">
              <span className="eyebrow">What</span>
              <input
                type="text"
                className="field"
                placeholder="Juneyao SIN to PVG"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </label>
            <label>
              <span className="eyebrow">Amount ¥</span>
              <input
                type="number"
                className="field"
                min={0}
                step={1}
                value={draft.amount || ''}
                onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })}
              />
            </label>
            <label>
              <span className="eyebrow">Covers</span>
              <input
                type="number"
                className="field"
                min={1}
                step={1}
                value={draft.people ?? 1}
                onChange={(e) => setDraft({ ...draft, people: Number(e.target.value) })}
              />
            </label>
            <label className="expwide">
              <span className="eyebrow">Note</span>
              <input
                type="text"
                className="field"
                placeholder="Optional"
                value={draft.note ?? ''}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </label>
            <button type="submit" className="edit" disabled={!canSave}>
              Add expense
            </button>
          </form>
        </section>

        {totals.length > 0 && (
          <section className="expbreak">
            <h2>
              Where it went
              <span className="en">Recorded spend by category</span>
            </h2>
            <ul className="expcats">
              {totals.map((c) => (
                <li key={c.category}>
                  <span className="expmark" aria-hidden>
                    {CATEGORY_MARKS[c.category]}
                  </span>
                  <div className="expcatmain">
                    <b>{CATEGORY_LABELS[c.category]}</b>
                    <span className="expcatcount">
                      {c.count} {c.count === 1 ? 'entry' : 'entries'}
                    </span>
                  </div>
                  <div className="expcatside">
                    <span className="expcattotal">{money(c.total)}</span>
                    <span className="expcatshare">
                      {spent > 0 ? `${Math.round((c.total / spent) * 100)}%` : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="expled">
          <h2>
            Everything recorded
            <span className="en">Newest first</span>
          </h2>

          {!loaded ? (
            <p className="empty">Loading</p>
          ) : rows.length === 0 ? (
            <p className="empty">
              Nothing recorded yet. Add a flight, a hotel night or a bowl of noodles above and it
              lands here.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>What</th>
                  <th>Category</th>
                  <th className="num">Amount</th>
                  <th className="num">Per person</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>{dayNumber(e.date, '—')}</td>
                    <td>
                      {e.label}
                      {e.note && <span className="expnote">{e.note}</span>}
                    </td>
                    <td>{CATEGORY_LABELS[e.category]}</td>
                    <td className="num">{money(e.amount)}</td>
                    <td className="num">{money(e.amount / Math.max(1, e.people ?? 1))}</td>
                    <td className="num">
                      <button type="button" className="expdel" onClick={() => remove(e.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total recorded</td>
                  <td className="num">{money(spent)}</td>
                  <td className="num">{money(spent / heads)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <section className="budget" id="budget">
          <h2>
            Planned, for comparison
            <span className="en">
              The itinerary's own estimates, per person, excluding flights and hotels
            </span>
          </h2>
          <p className="fine">
            Estimated {range(planned)} per person across {days.length}{' '}
            {days.length === 1 ? 'day' : 'days'}, against {money(spent / heads)} recorded here.
            <button type="button" className="explink" onClick={() => setShowPlan((v) => !v)}>
              {showPlan ? 'Hide the day by day estimate' : 'Show the day by day estimate'}
            </button>
          </p>

          {showPlan && (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>What</th>
                    <th className="num">Low</th>
                    <th className="num">High</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day, i) => {
                    const s = sumCosts(day.items);
                    return (
                      <tr key={day.id}>
                        <td>{dayNumber(day.date, `Day ${i + dayOffset}`)}</td>
                        <td>{day.label}</td>
                        <td className="num">{money(s.min)}</td>
                        <td className="num">{money(s.max)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total, per person</td>
                    <td className="num">{money(planned.min)}</td>
                    <td className="num">{money(planned.max)}</td>
                  </tr>
                </tfoot>
              </table>
              {planned.unknown > 0 && (
                <p className="fine">
                  {planned.unknown} {planned.unknown === 1 ? 'stop carries' : 'stops carry'} no
                  estimate, so the real number sits above this table. Flights and hotels are not
                  counted in the plan, which is what the entries above are for.
                </p>
              )}
            </>
          )}
        </section>
      </main>

      <footer>Safe travels</footer>
    </div>
  );
}
