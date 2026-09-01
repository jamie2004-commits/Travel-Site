import { useId, useState } from 'react';
import type { Day, ItineraryItem, TravelMode } from '../types';
import { itemTitle } from '../lib/catalog';
import { useCatalog } from '../lib/CatalogContext';
import { formatPrice } from '../lib/format';
import { TRAVEL_LABELS, TRAVEL_MARKS, legName, legRoute, legTimes } from '../lib/travel';

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
  const travel = item.travel;

  /** Turn the leg on, off, or over to the other mode. Off keeps nothing. */
  const setMode = (mode: TravelMode) =>
    onChange({ travel: travel?.mode === mode ? undefined : { ...travel, mode } });
  const setLeg = (patch: Partial<NonNullable<ItineraryItem['travel']>>) =>
    travel && onChange({ travel: { ...travel, ...patch } });
  const legField = (key: 'number' | 'carrier' | 'from' | 'to' | 'seat' | 'ref') => ({
    value: travel?.[key] ?? '',
    onChange: (e: { target: { value: string } }) =>
      setLeg({ [key]: e.target.value || undefined }),
  });

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
            title={clash ? 'Starts before the stop above it' : undefined}
          >
            {item.startTime ?? '· ·'}
          </span>
          {clash && (
            <span className="block text-[10px]" style={{ color: 'var(--plum)', lineHeight: 1.3 }}>
              out of order
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[16px] leading-snug font-semibold">
            {title.zh}
          </p>
          {title.en && (
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
              {title.en}
            </p>
          )}
          {travel && (
            <div
              className="mt-1.5 border-l-2 pl-2 text-[12px]"
              style={{ borderColor: 'var(--accent)', color: 'var(--muted)', lineHeight: 1.5 }}
            >
              <p style={{ color: 'var(--ink)', fontWeight: 600 }}>
                <span aria-hidden className="mr-1">
                  {TRAVEL_MARKS[travel.mode]}
                </span>
                {legName(travel)}
                <span className="ml-2 font-normal" style={{ color: 'var(--accent)' }}>
                  {legTimes(item)}
                </span>
              </p>
              {legRoute(travel) && <p>{legRoute(travel)}</p>}
              {(travel.seat || travel.ref) && (
                <p>
                  {[travel.seat && `Seat ${travel.seat}`, travel.ref && `Ref ${travel.ref}`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>
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

          <div className="grid gap-2 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow">Flight or train</span>
              {(['flight', 'train'] as TravelMode[]).map((mode) => {
                const on = travel?.mode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setMode(mode)}
                    aria-pressed={on}
                    className="border px-3 text-[13px]"
                    style={{
                      minHeight: 34,
                      borderRadius: 2,
                      borderColor: on ? 'var(--accent)' : 'var(--line)',
                      background: on ? 'var(--accent-soft)' : 'transparent',
                      color: on ? 'var(--ink)' : 'var(--muted)',
                      fontWeight: on ? 600 : 400,
                    }}
                  >
                    <span aria-hidden className="mr-1">
                      {TRAVEL_MARKS[mode]}
                    </span>
                    {TRAVEL_LABELS[mode]}
                  </button>
                );
              })}
              {travel && (
                <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                  Press {TRAVEL_LABELS[travel.mode]} again to clear
                </span>
              )}
            </div>

            {travel && (
              <div className="grid gap-2">
                <div className="flex flex-wrap gap-2">
                  <label className="grid gap-1">
                    <span className="eyebrow">
                      {travel.mode === 'flight' ? 'Flight no.' : 'Train no.'}
                    </span>
                    <input
                      className="field w-32"
                      placeholder={travel.mode === 'flight' ? 'HO1576' : 'G7538'}
                      {...legField('number')}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="eyebrow">
                      {travel.mode === 'flight' ? 'Airline' : 'Operator'}
                    </span>
                    <input
                      className="field w-44"
                      placeholder={travel.mode === 'flight' ? 'Juneyao Air' : 'China Railway'}
                      {...legField('carrier')}
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <label className="grid gap-1">
                    <span className="eyebrow">From</span>
                    <input
                      className="field zh w-52"
                      placeholder={travel.mode === 'flight' ? 'Changi T2' : 'Hangzhou East'}
                      {...legField('from')}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="eyebrow">To</span>
                    <input
                      className="field zh w-52"
                      placeholder={travel.mode === 'flight' ? '浦东 T1' : 'Shanghai Hongqiao'}
                      {...legField('to')}
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <label className="grid gap-1">
                    <span className="eyebrow">Arrives</span>
                    <input
                      type="time"
                      className="field"
                      value={travel.arrive ?? ''}
                      onChange={(e) => setLeg({ arrive: e.target.value || undefined })}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="eyebrow">Seat</span>
                    <input
                      className="field w-32"
                      placeholder={travel.mode === 'flight' ? '32A' : 'Car 5, 12F'}
                      {...legField('seat')}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="eyebrow">Booking ref</span>
                    <input className="field w-36" placeholder="ABC123" {...legField('ref')} />
                  </label>
                </div>

                <p className="text-[11px]" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
                  Departure is the start time above. An arrival earlier than it is read as the
                  next morning.
                </p>
              </div>
            )}
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
