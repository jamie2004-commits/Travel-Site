import type { District, Place } from '../types';
import { formatDuration, formatPrice } from '../lib/format';

interface Props {
  place: Place;
  district?: District;
  /** How many times this place already appears in the itinerary. */
  usedCount?: number;
  onAdd?: (place: Place, event: React.MouseEvent) => void;
  /** Only supplied for places added in the app, which can be deleted. */
  onRemove?: (place: Place) => void;
  /** Drag handle wiring, supplied once drag and drop is in play. */
  dragHandleProps?: Record<string, unknown>;
  dragging?: boolean;
}

export default function PlaceCard({
  place,
  district,
  usedCount = 0,
  onAdd,
  onRemove,
  dragHandleProps,
  dragging,
}: Props) {
  const price = formatPrice(place.priceMin, place.priceMax);
  const duration = formatDuration(place.durationMinutes);

  return (
    <article
      className="relative border bg-[var(--card)] p-4 transition-shadow"
      style={{
        borderColor: usedCount ? 'var(--accent)' : 'var(--line)',
        borderRadius: 2,
        boxShadow: dragging ? '0 12px 30px rgba(0,0,0,.14)' : undefined,
        opacity: dragging ? 0.9 : 1,
      }}
      {...dragHandleProps}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {onRemove && (
            <p className="eyebrow" style={{ color: 'var(--accent2)' }}>
              Added by you
            </p>
          )}
          <h3 className="zh truncate text-[19px] leading-tight font-semibold">{place.nameZh}</h3>
          {place.nameEn !== place.nameZh && (
            <p className="truncate text-[12px]" style={{ color: 'var(--muted)' }}>
              {place.nameEn}
            </p>
          )}
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(place)}
            aria-label={`删除 Delete ${place.nameEn}`}
            className="shrink-0 border px-2 text-[16px]"
            style={{ minHeight: 40, minWidth: 40, borderRadius: 2, borderColor: 'var(--line)', color: 'var(--muted)' }}
          >
            ×
          </button>
        )}
        {onAdd && (
          <button
            type="button"
            onClick={(e) => onAdd(place, e)}
            aria-label={`加入行程 Add ${place.nameEn} to a day`}
            className="shrink-0 border px-3 text-[13px] font-medium"
            style={{
              minHeight: 40,
              minWidth: 44,
              borderRadius: 2,
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
              background: 'var(--accent-soft)',
            }}
          >
            加入
          </button>
        )}
      </div>

      <p className="mb-3 text-[13px]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
        {place.description}
      </p>

      {place.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {place.tags.map((tag, i) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-[11px] font-medium"
              style={{
                borderRadius: 2,
                background: i % 2 === 0 ? 'var(--accent-soft)' : 'var(--accent2-soft)',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-[12px]"
        style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}
      >
        <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{price}</span>
        {duration && <span>{duration}</span>}
        {district && (
          <span className="zh">
            {district.nameZh}
            <span className="ml-1" style={{ fontFamily: 'var(--font-sans)' }}>
              {district.nameEn}
            </span>
          </span>
        )}
      </div>

      {place.metro && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px]" style={{ color: 'var(--muted)' }}>
          <span
            aria-hidden
            className="mt-1.5 inline-block shrink-0"
            style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--accent2)' }}
          />
          <span>{place.metro}</span>
        </p>
      )}

      {place.addressZh && (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
          {place.addressZh}
        </p>
      )}

      {usedCount > 0 && (
        <span
          className="absolute -top-2 -left-2 flex items-center justify-center text-[11px] font-bold text-white"
          style={{ minWidth: 20, height: 20, borderRadius: 999, background: 'var(--accent)' }}
          title={`已加入 ${usedCount} 次 · in the itinerary ${usedCount} time${usedCount > 1 ? 's' : ''}`}
        >
          {usedCount}
        </span>
      )}
    </article>
  );
}
