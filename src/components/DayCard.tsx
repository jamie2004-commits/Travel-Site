import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Day, ItineraryItem } from '../types';
import { formatCostSum, sumCosts } from '../lib/format';
import SortableItemRow from './SortableItemRow';
import { dayDropId, itemDragId } from './dnd';

interface Props {
  day: Day;
  index: number;
  total: number;
  onRemoveDay: () => void;
  onMoveDay: (direction: -1 | 1) => void;
  onRemoveItem: (itemId: string) => void;
  onChangeItem: (itemId: string, patch: Partial<ItineraryItem>) => void;
  onAddCustom: (title: string) => void;
  onChangeDay: (patch: Partial<Pick<Day, 'label' | 'date'>>) => void;
}

export default function DayCard({
  day,
  index,
  total,
  onRemoveDay,
  onMoveDay,
  onRemoveItem,
  onChangeItem,
  onAddCustom,
  onChangeDay,
}: Props) {
  const [customTitle, setCustomTitle] = useState('');
  const cost = sumCosts(day.items);
  const { setNodeRef, isOver } = useDroppable({
    id: dayDropId(day.id),
    data: { type: 'day', dayId: day.id },
  });

  return (
    <section
      ref={setNodeRef}
      className="border"
      style={{
        background: 'var(--card)',
        borderColor: isOver ? 'var(--accent)' : 'var(--line)',
        boxShadow: isOver ? '0 0 0 2px var(--accent-soft)' : undefined,
        borderRadius: 2,
      }}
      aria-label={`${day.label}, day ${index + 1}`}
    >
      <header
        className="flex items-start gap-2 border-b px-3 py-2.5"
        style={{ borderColor: 'var(--line)', background: 'var(--mist)' }}
      >
        <div className="min-w-0 flex-1">
          <p className="eyebrow">
            Day {index + 1}
            {day.date ? ` · ${day.date}` : ''}
          </p>
          <label className="sr-only" htmlFor={`day-label-${day.id}`}>
            Day name
          </label>
          <input
            id={`day-label-${day.id}`}
            value={day.label}
            onChange={(e) => onChangeDay({ label: e.target.value })}
            className="zh w-full border-0 bg-transparent p-0 text-[19px] leading-tight font-semibold focus:outline-none"
            style={{ color: 'var(--ink)' }}
          />
        </div>
        <span
          className="mt-1 shrink-0 px-2 py-0.5 text-[12px]"
          style={{ background: 'var(--accent2-soft)', borderRadius: 2 }}
          title="Estimated for this day"
        >
          {formatCostSum(cost)}
        </span>
        <div className="flex shrink-0 gap-0.5">
          <button
            type="button"
            onClick={() => onMoveDay(-1)}
            disabled={index === 0}
            aria-label="上移 Move day up"
            className="h-10 w-9 text-[14px] disabled:opacity-25"
            style={{ color: 'var(--muted)' }}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMoveDay(1)}
            disabled={index === total - 1}
            aria-label="下移 Move day down"
            className="h-10 w-9 text-[14px] disabled:opacity-25"
            style={{ color: 'var(--muted)' }}
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemoveDay}
            aria-label={`删除 Remove ${day.label}`}
            className="h-10 w-9 text-[16px]"
            style={{ color: 'var(--plum)' }}
          >
            ×
          </button>
        </div>
      </header>

      <div className="px-3">
        {day.items.length === 0 ? (
          <p className="py-6 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
            这一天还空着
            <span className="mt-1 block text-[12px]">
              Add places from the library, or drop one here
            </span>
          </p>
        ) : (
          <SortableContext
            items={day.items.map((i) => itemDragId(i.id))}
            strategy={verticalListSortingStrategy}
          >
            <ul className="list-none">
              {day.items.map((item, i) => (
                <SortableItemRow
                  key={item.id}
                  item={item}
                  day={day}
                  index={i}
                  onRemove={() => onRemoveItem(item.id)}
                  onChange={(patch) => onChangeItem(item.id, patch)}
                />
              ))}
            </ul>
          </SortableContext>
        )}

        <form
          className="flex gap-2 border-t py-2.5"
          style={{ borderColor: 'var(--line)' }}
          onSubmit={(e) => {
            e.preventDefault();
            const title = customTitle.trim();
            if (!title) return;
            onAddCustom(title);
            setCustomTitle('');
          }}
        >
          <label className="sr-only" htmlFor={`custom-${day.id}`}>
            Add a custom item to {day.label}
          </label>
          <input
            id={`custom-${day.id}`}
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            placeholder="自定义一项  Nap, fly home, anything"
            className="field flex-1"
          />
          <button
            type="submit"
            disabled={!customTitle.trim()}
            className="border px-3 text-[13px] disabled:opacity-30"
            style={{ minHeight: 40, borderRadius: 2, borderColor: 'var(--line)', color: 'var(--muted)' }}
          >
            加入 Add
          </button>
        </form>
      </div>
    </section>
  );
}
