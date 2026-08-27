import type { Action, State } from '../lib/store';
import { formatCostSum, sumCosts } from '../lib/format';
import DayCard from './DayCard';

interface Props {
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
}: Props) {
  const { itinerary } = state;
  const total = sumCosts(itinerary.days.flatMap((d) => d.items));

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
          className="zh w-full border-0 bg-transparent p-0 text-[24px] leading-tight font-black focus:outline-none"
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
            加一天 Add day
          </button>
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title={undoLabel}
            className="border px-3 text-[14px] disabled:opacity-30"
            style={{ minHeight: 40, borderRadius: 2, borderColor: 'var(--line)', color: 'var(--muted)' }}
          >
            撤销 Undo
          </button>
          <button
            type="button"
            onClick={onReset}
            className="ml-auto border px-3 text-[14px]"
            style={{ minHeight: 40, borderRadius: 2, borderColor: 'var(--line)', color: 'var(--plum)' }}
          >
            清空 Reset
          </button>
        </div>
      </div>

      <div className="pane flex-1 px-4 py-4">
        <div className="grid gap-3">
          {itinerary.days.map((day, i) => (
            <DayCard
              key={day.id}
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
            />
          ))}
          {itinerary.days.length === 0 && (
            <p className="py-10 text-center text-[14px]" style={{ color: 'var(--muted)' }}>
              还没有任何一天
              <span className="mt-1 block text-[12px]">Add a day to start</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
