import { useEffect, useRef, useState } from 'react';
import type { Action, State } from '../lib/store';
import { formatCostSum, sumCosts } from '../lib/format';
import { download, fileStem, toHtml, toText } from '../lib/export';
import { useCatalog } from '../lib/CatalogContext';
import DayCard from './DayCard';

interface Props {
  onExported?: (message: string) => void;
  activeDayId: string | null;
  onFocusDay: (dayId: string) => void;
  state: State;
  dispatch: React.Dispatch<Action>;
  canUndo: boolean;
  undoLabel: string;
  onUndo: () => void;
  onReset: () => void;
}

export default function ItineraryPane({
  state,
  dispatch,
  canUndo,
  undoLabel,
  onUndo,
  onReset,
  onExported,
  activeDayId,
  onFocusDay,
}: Props) {
  const { catalog } = useCatalog();
  const [more, setMore] = useState(false);
  const { itinerary } = state;
  const total = sumCosts(itinerary.days.flatMap((d) => d.items));
  const scroller = useRef<HTMLDivElement>(null);

  // Choosing a day anywhere in the app brings it into view here, so the two
  // panes never disagree about what is being worked on.
  useEffect(() => {
    if (!activeDayId) return;
    const node = scroller.current?.querySelector(`[data-day-id="${activeDayId}"]`);
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeDayId]);

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="My itinerary">
      <div
        className="shrink-0 border-b px-4 pt-4 pb-3"
        style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}
      >
        <label className="eyebrow block" htmlFor="trip-name">
          Trip name
        </label>
        <input
          id="trip-name"
          value={itinerary.name}
          onChange={(e) => dispatch({ type: 'renameTrip', name: e.target.value })}
          className="w-full border-0 bg-transparent p-0 text-[24px] leading-tight font-black focus:outline-none"
          style={{ color: 'var(--ink)' }}
        />

        <p className="mt-1 text-[13px]" style={{ color: 'var(--muted)' }}>
          <span className="eyebrow">Trip total</span>
          <span className="ml-2 text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
            {formatCostSum(total)}
          </span>
          <span className="ml-2 text-[11px]">
            {itinerary.days.length} days · {itinerary.days.reduce((n, d) => n + d.items.length, 0)} items
          </span>
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => dispatch({ type: 'addDay' })}
            className="border px-3 text-[14px] font-medium"
            style={{
              minHeight: 40,
              borderRadius: 2,
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
              background: 'var(--accent-soft)',
            }}
          >
            Add day
          </button>
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title={undoLabel}
            className="border px-3 text-[14px] disabled:opacity-30"
            style={{ minHeight: 40, borderRadius: 2, borderColor: 'var(--line)', color: 'var(--muted)' }}
          >
            Undo
            {canUndo && (
              <span className="ml-1.5 text-[12px]" style={{ opacity: 0.8 }}>
                {undoLabel}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setMore((v) => !v)}
            aria-expanded={more}
            className="ml-auto border px-3 text-[14px]"
            style={{
              minHeight: 40,
              borderRadius: 2,
              borderColor: more ? 'var(--accent)' : 'var(--line)',
              color: more ? 'var(--accent)' : 'var(--muted)',
            }}
          >
            Export and more
          </button>
        </div>

        {more && (
          <div
            className="mt-2 flex flex-wrap items-center gap-2 border p-2"
            style={{ borderColor: 'var(--line)', borderRadius: 2, background: 'var(--mist)' }}
          >
            <button
              type="button"
              onClick={() => {
                download(`${fileStem(itinerary.name)}.html`, toHtml(itinerary, catalog), 'text/html');
                onExported?.('Downloaded as HTML');
              }}
              className="border px-3 text-[14px]"
              style={{ minHeight: 40, borderRadius: 2, borderColor: 'var(--line)', color: 'var(--ink)', background: 'var(--card)' }}
            >
              Export HTML
            </button>
            <button
              type="button"
              onClick={async () => {
                const text = toText(itinerary, catalog);
                try {
                  await navigator.clipboard.writeText(text);
                  onExported?.('Copied as plain text');
                } catch {
                  download(`${fileStem(itinerary.name)}.txt`, text, 'text/plain');
                  onExported?.('Downloaded as plain text');
                }
              }}
              className="border px-3 text-[14px]"
              style={{ minHeight: 40, borderRadius: 2, borderColor: 'var(--line)', color: 'var(--ink)', background: 'var(--card)' }}
            >
              Copy as text
            </button>
            <button
              type="button"
              onClick={onReset}
              className="ml-auto border px-3 text-[14px]"
              style={{ minHeight: 40, borderRadius: 2, borderColor: 'var(--line)', color: 'var(--plum)', background: 'var(--card)' }}
            >
              Reset
            </button>
          </div>
        )}
      </div>

      <div className="pane flex-1 px-4 py-4" ref={scroller}>
        <div className="grid gap-3">
          {itinerary.days.map((day, i) => (
            <div key={day.id} data-day-id={day.id}>
            <DayCard
              day={day}
              index={i}
              total={itinerary.days.length}
              onRemoveDay={() => dispatch({ type: 'removeDay', dayId: day.id })}
              onMoveDay={(direction) =>
                dispatch({
                  type: 'moveDay',
                  from: i,
                  to: Math.max(0, Math.min(itinerary.days.length - 1, i + direction)),
                })
              }
              onRemoveItem={(itemId) => dispatch({ type: 'removeItem', dayId: day.id, itemId })}
              onChangeItem={(itemId, patch) =>
                dispatch({ type: 'updateItem', dayId: day.id, itemId, patch })
              }
              onAddCustom={(title) => dispatch({ type: 'addCustom', dayId: day.id, title })}
              onChangeDay={(patch) => dispatch({ type: 'updateDay', dayId: day.id, patch })}
              active={day.id === activeDayId}
              onFocus={() => onFocusDay(day.id)}
              onRetime={(start, gap) => dispatch({ type: 'retimeDay', dayId: day.id, start, gap })}
            />
            </div>
          ))}
          {itinerary.days.length === 0 && (
            <p className="py-10 text-center text-[14px]" style={{ color: 'var(--muted)' }}>
              No days yet
              <span className="mt-1 block text-[12px]">Add a day to start</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
