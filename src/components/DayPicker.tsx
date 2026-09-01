import { useEffect, useRef } from 'react';
import type { Day } from '../types';
import { dayNumberOffset } from '../lib/days';

interface Props {
  days: Day[];
  title: string;
  onPick: (dayId: string) => void;
  onCancel: () => void;
}

/** Shown when a place is added and there is more than one day to put it in. */
export default function DayPicker({ days, title, onPick, onCancel }: Props) {
  const offset = dayNumberOffset(days);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: 'rgba(18,33,31,.45)' }}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pick a day"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md border p-4"
        style={{ background: 'var(--card)', borderColor: 'var(--line)', borderRadius: 2 }}
      >
        <p className="eyebrow mb-1">Add to which day</p>
        <h2 className="mb-4 text-[20px] font-semibold">{title}</h2>
        <div className="grid max-h-[55vh] gap-2 overflow-y-auto">
          {days.map((day, i) => (
            <button
              key={day.id}
              ref={i === 0 ? first : undefined}
              type="button"
              onClick={() => onPick(day.id)}
              className="flex items-center justify-between border px-3 text-left"
              style={{ minHeight: 48, borderRadius: 2, borderColor: 'var(--line)' }}
            >
              <span>
                <span className="text-[16px] font-semibold">{day.label}</span>
                <span className="ml-2 text-[11px]" style={{ color: 'var(--muted)' }}>
                  Day {i + offset}
                  {day.date ? ` · ${day.date}` : ''}
                </span>
              </span>
              <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
                {day.items.length}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 w-full border text-[14px]"
          style={{ minHeight: 44, borderRadius: 2, borderColor: 'var(--line)', color: 'var(--muted)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
