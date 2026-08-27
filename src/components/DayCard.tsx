import type { Day } from '../types';
import ItemRow from './ItemRow';

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
  return (
    <section
      className="border"
      style={{ background: 'var(--card)', borderColor: 'var(--line)', borderRadius: 2 }}
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
          <ul className="list-none">
            {day.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                day={day}
                onRemove={() => onRemoveItem(item.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
