import { useId, useState } from 'react';
import type { Day, ItineraryItem } from '../types';
import { itemTitle } from '../lib/catalog';
import { useCatalog } from '../lib/CatalogContext';
import { addMinutes, formatDuration, formatPrice } from '../lib/format';

interface Props {
  item: ItineraryItem;
  day: Day;
  onRemove: () => void;
  onChange: (patch: Partial<ItineraryItem>) => void;
  dragHandleProps?: Record<string, unknown>;
  dragging?: boolean;
  /** This item starts before the one above it has finished. */
  clash?: boolean;
}

/**
 * Latin-only strings should not pick up the Chinese serif face.
 * Escaped rather than literal so the pattern survives a page served without a
 * charset, where literal CJK is mis-decoded and the regex fails to parse.
 */
const hasCjk = (s: string) => /[\u3400-\u9fff\uf900-\ufaff]/.test(s);

const numberOrUndefined = (value: string) =>
  value.trim() === '' ? undefined : Math.max(0, Number(value));

export default function ItemRow({
  item,
  onRemove,
  onChange,
  dragHandleProps,
  dragging,
  clash,
}: Props) {
  const { catalog } = useCatalog();
  const [editing, setEditing] = useState(false);
  const fieldId = useId();
  const title = itemTitle(catalog, item.placeId, item.customTitle);
  const place = item.placeId ? catalog.placeById[item.placeId] : undefined;
  const duration = formatDuration(item.durationMinutes);
  const endsAt =
    item.startTime && item.durationMinutes
      ? addMinutes(item.startTime, item.durationMinutes)
      : undefined;

  return (
    <li
      className="border-b py-3 last:border-b-0"
      style={{ borderColor: 'var(--line)', opacity: dragging ? 0.5 : 1 }}
    >
      <div className="flex gap-3">
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
            style={{ color: clash ? 'var(--plum)' : item.startTime ? 'var(--accent)' : 'var(--muted)' }}
            title={clash ? 'Starts before the stop above ends' : undefined}
          >
            {item.startTime ?? '· ·'}
          </span>
          {clash && (
            <span className="block text-[10px]" style={{ color: 'var(--plum)', lineHeight: 1.3 }}>
              overlaps
            </span>
          )}
          {duration && (
            <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>
              {duration}
            </span>
          )}
          {endsAt && (
            <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>
              to {endsAt}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p
            className={`${hasCjk(title.zh) ? 'zh' : ''} text-[16px] leading-snug font-semibold`}
          >
            {title.zh}
          </p>
          {title.en && (
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
              {title.en}
            </p>
          )}
          {item.note && !editing && (
            <p className="mt-1 text-[12px]" style={{ color: 'var(--muted)', lineHeight: 1.55 }}>
              {item.note}
            </p>
          )}
          <div
            className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px]"
            style={{ color: 'var(--muted)' }}
          >
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

        <div className="flex shrink-0 flex-col items-center">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            aria-controls={fieldId}
            aria-label={`Edit ${title.en || title.zh}`}
            className="h-11 w-11 text-[14px]"
            style={{ color: editing ? 'var(--accent)' : 'var(--muted)' }}
          >
            ✎
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${title.en || title.zh}`}
            className="h-11 w-11 text-[18px]"
            style={{ color: 'var(--muted)' }}
          >
            ×
          </button>
        </div>
      </div>

      {editing && (
        <div
          id={fieldId}
          className="mt-2 ml-[74px] grid gap-2 border-l pl-3"
          style={{ borderColor: 'var(--accent)' }}
        >
          {item.customTitle !== undefined && (
            <label className="grid gap-1">
              <span className="eyebrow">Title</span>
              <input
                className="field zh"
                value={item.customTitle}
                onChange={(e) => onChange({ customTitle: e.target.value })}
              />
            </label>
          )}

          <div className="flex flex-wrap gap-2">
            <label className="grid gap-1">
              <span className="eyebrow">Start</span>
              <input
                type="time"
                className="field"
                value={item.startTime ?? ''}
                onChange={(e) => onChange({ startTime: e.target.value || undefined })}
              />
            </label>
            <label className="grid gap-1">
              <span className="eyebrow">Minutes</span>
              <input
                type="number"
                min={0}
                step={15}
                className="field w-24"
                value={item.durationMinutes ?? ''}
                onChange={(e) => onChange({ durationMinutes: numberOrUndefined(e.target.value) })}
              />
            </label>
            <label className="grid gap-1">
              <span className="eyebrow">Cost low</span>
              <input
                type="number"
                min={0}
                className="field w-24"
                value={item.estCostMin ?? ''}
                onChange={(e) => onChange({ estCostMin: numberOrUndefined(e.target.value) })}
              />
            </label>
            <label className="grid gap-1">
              <span className="eyebrow">Cost high</span>
              <input
                type="number"
                min={0}
                className="field w-24"
                value={item.estCostMax ?? ''}
                onChange={(e) => onChange({ estCostMax: numberOrUndefined(e.target.value) })}
              />
            </label>
          </div>

          <label className="grid gap-1">
            <span className="eyebrow">Note</span>
            <textarea
              className="field"
              rows={3}
              value={item.note ?? ''}
              onChange={(e) => onChange({ note: e.target.value || undefined })}
            />
          </label>

          <button
            type="button"
            onClick={() => setEditing(false)}
            className="justify-self-start border px-3 text-[13px]"
            style={{ minHeight: 38, borderRadius: 2, borderColor: 'var(--line)', color: 'var(--muted)' }}
          >
            Done
          </button>
        </div>
      )}
    </li>
  );
}
