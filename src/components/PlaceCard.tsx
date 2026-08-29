import type { District, Place } from '../types';
import { formatDuration, formatPrice } from '../lib/format';

interface Props {
  place: Place;
  district?: District;
  /** How many times this place already sits in the day being planned. */
  usedHere?: number;
  /** How many times it sits anywhere in the trip. */
  usedTotal?: number;
  /** The day the add button targets, so the label can name it. */
  activeDayLabel?: string;
  onAdd?: (place: Place) => void;
  /** Opens the day picker, for the one time in ten it is not the active day. */
  onAddElsewhere?: (place: Place) => void;
  /** Only supplied for places added in the app, which can be deleted. */
  onRemove?: (place: Place) => void;
  /** Drag handle wiring, supplied once drag and drop is in play. */
  dragHandleProps?: Record<string, unknown>;
  dragging?: boolean;
}

export default function PlaceCard({
  place,
  district,
  usedHere = 0,
  usedTotal = 0,
  activeDayLabel,
  onAdd,
  onAddElsewhere,
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
        borderColor: usedHere ? 'var(--accent)' : usedTotal ? 'var(--accent2)' : 'var(--line)',
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
          <div className="flex shrink-0">
            <button
              type="button"
              onClick={() => onAdd(place)}
              aria-label={`加入 Add ${place.nameEn} to ${activeDayLabel ?? 'the itinerary'}`}
              className="border px-3 text-[13px] font-medium"
              style={{
                minHeight: 40,
                borderRadius: 2,
                borderColor: 'var(--accent)',
                color: 'var(--accent)',
                background: 'var(--accent-soft)',
              }}
            >
              加入
              {activeDayLabel && (
                <span
                  className="zh ml-1 inline-block max-w-[7em] truncate align-bottom text-[12px] font-normal"
                >
                  {activeDayLabel}
                </span>
              )}
            </button>
            {onAddElsewhere && (
              <button
                type="button"
                onClick={() => onAddElsewhere(place)}
                aria-label={`加到别的一天 Add ${place.nameEn} to another day`}
                title="加到别的一天 Add to another day"
                className="border border-l-0 px-2 text-[12px]"
                style={{
                  minHeight: 40,
                  borderRadius: 2,
                  borderColor: 'var(--accent)',
                  color: 'var(--accent)',
                  background: 'var(--accent-soft)',
                }}
              >
                ▾
              </button>
            )}
          </div>
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

      {usedTotal > 0 && (
        <span
          className="absolute -top-2 -left-2 flex items-center gap-1 px-1.5 text-[11px] font-bold text-white"
          style={{
            minWidth: 20,
            height: 20,
            borderRadius: 999,
            background: usedHere ? 'var(--accent)' : 'var(--accent2)',
          }}
          title={
            usedHere
              ? `已在${activeDayLabel ?? ''}加入 ${usedHere} 次 · in this day ${usedHere} time${usedHere > 1 ? 's' : ''}, ${usedTotal} in the trip`
              : `已在别的一天 · elsewhere in the trip ${usedTotal} time${usedTotal > 1 ? 's' : ''}`
          }
        >
          {usedHere ? usedHere : `已排 ${usedTotal}`}
        </span>
      )}

    </article>
  );
}
