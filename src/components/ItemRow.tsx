import type { Day, ItineraryItem } from '../types';
import { itemTitle, placeById } from '../lib/places';
import { formatDuration, formatPrice } from '../lib/format';

interface Props {
  item: ItineraryItem;
  day: Day;
  onRemove: () => void;
  dragHandleProps?: Record<string, unknown>;
  dragging?: boolean;
}

export default function ItemRow({ item, onRemove, dragHandleProps, dragging }: Props) {
  const title = itemTitle(item.placeId, item.customTitle);
  const place = item.placeId ? placeById[item.placeId] : undefined;
  const duration = formatDuration(item.durationMinutes);

  return (
    <li
      className="flex gap-3 border-b py-3 last:border-b-0"
      style={{ borderColor: 'var(--line)', opacity: dragging ? 0.5 : 1 }}
    >
      <div
        className="w-[62px] shrink-0 pt-0.5 select-none"
        style={{ cursor: dragHandleProps ? 'grab' : undefined, touchAction: 'none' }}
        {...dragHandleProps}
      >
        {dragHandleProps && (
          <span
            aria-hidden
            className="mb-0.5 block text-[11px] leading-none"
            style={{ color: 'var(--line)', letterSpacing: 2 }}
          >
            ⣿
          </span>
        )}
        <span
          className="block text-[12px] font-bold tracking-wider"
          style={{ color: item.startTime ? 'var(--accent)' : 'var(--muted)' }}
        >
          {item.startTime ?? '· ·'}
        </span>
        {duration && (
          <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>
            {duration}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="zh text-[16px] leading-snug font-semibold">{title.zh}</p>
        {title.en && (
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
            {title.en}
          </p>
        )}
        {item.note && (
          <p className="mt-1 text-[12px]" style={{ color: 'var(--muted)', lineHeight: 1.55 }}>
            {item.note}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px]" style={{ color: 'var(--muted)' }}>
          {(item.estCostMin !== undefined || item.estCostMax !== undefined) && (
            <span
              className="px-2 py-0.5"
              style={{ background: 'var(--accent2-soft)', borderRadius: 2, color: 'var(--ink)' }}
            >
              {formatPrice(item.estCostMin, item.estCostMax)}
            </span>
          )}
          {place?.metro && <span>{place.metro}</span>}
        </div>
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`移除 Remove ${title.zh}`}
        className="h-11 w-11 shrink-0 self-start text-[18px]"
        style={{ color: 'var(--muted)' }}
      >
        ×
      </button>
    </li>
  );
}
