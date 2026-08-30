import { useEffect, useRef } from 'react';
import type { Day } from '../types';
import { formatCostSum, sumCosts } from '../lib/format';

interface Props {
  days: Day[];
  activeDayId: string | null;
  onSelect: (dayId: string) => void;
  onAddDay: () => void;
}

/**
 * The one place the whole app agrees on: which day is being planned. Browsing
 * adds to it, the itinerary scrolls to it, and it stays on screen in both
 * panes so adding never has to stop and ask.
 */
export default function DayRail({ days, activeDayId, onSelect, onAddDay }: Props) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // Keep the selected chip in view when the selection moves on its own, for
  // instance after a day is removed or the app opens onto a long trip.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeDayId]);

  return (
    <div
      className="flex shrink-0 items-stretch gap-1.5 overflow-x-auto px-3 py-2"
      style={{ background: 'var(--mist)', borderColor: 'var(--line)' }}
      role="tablist"
      aria-label="Day being planned"
    >
      {days.map((day, i) => {
        const active = day.id === activeDayId;
        const cost = sumCosts(day.items);
        return (
          <button
            key={day.id}
            ref={active ? activeRef : undefined}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(day.id)}
            className="shrink-0 border px-3 py-1.5 text-left"
            style={{
              minHeight: 46,
              borderRadius: 2,
              borderColor: active ? 'var(--accent)' : 'var(--line)',
              background: active ? 'var(--accent)' : 'var(--card)',
              color: active ? '#fff' : 'var(--muted)',
            }}
            title={`${day.label} · ${formatCostSum(cost)}`}
          >
            <span className="block text-[15px] leading-tight font-semibold">{day.label}</span>
            <span
              className="block text-[10px] tracking-[0.14em] uppercase"
              style={{ opacity: active ? 0.85 : 1 }}
            >
              Day {i + 1} · {day.items.length}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAddDay}
        className="shrink-0 border border-dashed px-3 text-[13px]"
        style={{
          minHeight: 46,
          borderRadius: 2,
          borderColor: 'var(--line)',
          color: 'var(--muted)',
          background: 'transparent',
        }}
      >
        + Add day
      </button>
    </div>
  );
}
