import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Day } from '../types';
import SortableItemRow from './SortableItemRow';
import { dayDropId, itemDragId } from './dnd';

interface Props {
  day: Day;
  index: number;
  total: number;
  onRemoveDay: () => void;
  onMoveDay: (direction: -1 | 1) => void;
  onRemoveItem: (itemId: string) => void;
}

export default function DayCard({
  day,
  index,
  total,
  onRemoveDay,
  onMoveDay,
  onRemoveItem,
}: Props) {
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
          <p className="zh truncate text-[19px] leading-tight font-semibold">{day.label}</p>
        </div>
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
                />
              ))}
            </ul>
          </SortableContext>
        )}
      </div>
    </section>
  );
}
