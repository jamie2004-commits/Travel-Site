import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Day, ItineraryItem, Stay } from '../types';
import { formatCostSum, sumCosts, CITY_LABELS } from '../lib/format';
import { clashes, dayCities, dayWindow, describeWindow } from '../lib/schedule';
import { stayDetails } from '../lib/stay';
import { useCatalog } from '../lib/CatalogContext';
import SortableItemRow from './SortableItemRow';
import { dayDropId, itemDragId } from './dnd';

interface Props {
  day: Day;
  index: number;
  /** The number printed against this day, which is not always index + 1. */
  number: number;
  total: number;
  onRemoveDay: () => void;
  onMoveDay: (direction: -1 | 1) => void;
  onRemoveItem: (itemId: string) => void;
  onChangeItem: (itemId: string, patch: Partial<ItineraryItem>) => void;
  onAddCustom: (title: string) => void;
  onChangeDay: (patch: Partial<Pick<Day, 'label' | 'date' | 'stay'>>) => void;
  /** True for the day the library is currently adding to. */
  active?: boolean;
  onFocus?: () => void;
  onRetime: (start: string, every: number) => void;
}

export default function DayCard({
  day,
  index,
  number,
  total,
  onRemoveDay,
  onMoveDay,
  onRemoveItem,
  onChangeItem,
  onAddCustom,
  onChangeDay,
  active = false,
  onFocus,
  onRetime,
}: Props) {
  const { catalog } = useCatalog();
  const [customTitle, setCustomTitle] = useState('');
  const [timing, setTiming] = useState(false);
  const [staying, setStaying] = useState(false);
  const [start, setStart] = useState('09:00');
  const [every, setEvery] = useState(60);
  const cost = sumCosts(day.items);
  const window = dayWindow(day.items);
  const clash = clashes(day.items);
  const cities = dayCities(day.items, catalog);
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
        borderColor: isOver || active ? 'var(--accent)' : 'var(--line)',
        boxShadow: isOver ? '0 0 0 2px var(--accent-soft)' : undefined,
        borderRadius: 2,
      }}
      aria-label={`${day.label}, day ${number}`}
      onFocusCapture={onFocus}
      onPointerDownCapture={onFocus}
    >
      <header
        className="flex flex-wrap items-start gap-2 border-b px-3 py-2.5"
        style={{ borderColor: 'var(--line)', background: 'var(--mist)' }}
      >
        {/* On a narrow screen the day name takes the line to itself and the
            cost and buttons wrap under it, rather than the name being squeezed
            to a few characters. That squeeze was the width it had in the old
            two-pane builder, and the reason renaming a day was a fiddle. */}
        <div className="min-w-0 w-full sm:w-auto sm:flex-1">
          <p className="eyebrow">
            Day {number}
            {day.date ? ` · ${day.date}` : ''}
            {active && (
              <span className="ml-2" style={{ color: 'var(--accent)' }}>
                planning
              </span>
            )}
          </p>
          <label className="sr-only" htmlFor={`day-label-${day.id}`}>
            Day name
          </label>
          <input
            id={`day-label-${day.id}`}
            value={day.label}
            onChange={(e) => onChangeDay({ label: e.target.value })}
            className="w-full border-0 bg-transparent p-0 text-[19px] leading-tight font-semibold focus:outline-none"
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
            aria-label="Move day up"
            className="h-10 w-9 text-[14px] disabled:opacity-25"
            style={{ color: 'var(--muted)' }}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMoveDay(1)}
            disabled={index === total - 1}
            aria-label="Move day down"
            className="h-10 w-9 text-[14px] disabled:opacity-25"
            style={{ color: 'var(--muted)' }}
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemoveDay}
            aria-label={`Remove ${day.label}`}
            className="h-10 w-9 text-[16px]"
            style={{ color: 'var(--plum)' }}
          >
            ×
          </button>
        </div>
      </header>

      {day.items.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-[12px]"
          style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}
        >
          {describeWindow(window) && (
            <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{describeWindow(window)}</span>
          )}
          {cities.map((c) => (
            <span key={c} className="px-1.5" style={{ background: 'var(--accent-soft)', borderRadius: 2 }}>
              {CITY_LABELS[c]}
            </span>
          ))}
          {window.untimed > 0 && <span>{window.untimed} without a time</span>}
          <button
            type="button"
            onClick={() => setTiming((v) => !v)}
            aria-expanded={timing}
            className="ml-auto border px-2 text-[12px]"
            style={{
              minHeight: 32,
              borderRadius: 2,
              borderColor: timing ? 'var(--accent)' : 'var(--line)',
              color: timing ? 'var(--accent)' : 'var(--muted)',
            }}
          >
            Set times
          </button>
        </div>
      )}

      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-[12px]"
        style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}
      >
        {day.stay?.name ? (
          <>
            <span aria-hidden>{'\u{1F6CF}'}</span>
            <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{day.stay.name}</span>
            {day.stay.address && <span>{day.stay.address}</span>}
            {stayDetails(day.stay) && <span>{stayDetails(day.stay)}</span>}
          </>
        ) : (
          <span>No hotel set for this night</span>
        )}
        <button
          type="button"
          onClick={() => setStaying((v) => !v)}
          aria-expanded={staying}
          className="ml-auto border px-2 text-[12px]"
          style={{
            minHeight: 32,
            borderRadius: 2,
            borderColor: staying ? 'var(--accent)' : 'var(--line)',
            color: staying ? 'var(--accent)' : 'var(--muted)',
          }}
        >
          {day.stay?.name ? 'Edit hotel' : 'Add hotel'}
        </button>
      </div>

      {staying && (
        <div
          className="grid gap-2 border-b px-3 py-2.5"
          style={{ borderColor: 'var(--line)', background: 'var(--accent-soft)' }}
        >
          <StayFields
            stay={day.stay}
            onChange={(stay) => onChangeDay({ stay })}
            onDone={() => setStaying(false)}
          />
        </div>
      )}

      {timing && day.items.length > 0 && (
        <div
          className="flex flex-wrap items-end gap-2 border-b px-3 py-2.5"
          style={{ borderColor: 'var(--line)', background: 'var(--accent-soft)' }}
        >
          <label className="grid gap-1">
            <span className="eyebrow">Start at</span>
            <input
              type="time"
              className="field"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="grid gap-1">
            <span className="eyebrow">A stop every</span>
            <select
              className="field"
              value={every}
              onChange={(e) => setEvery(Number(e.target.value))}
            >
              {[30, 45, 60, 90, 120].map((g) => (
                <option key={g} value={g}>
                  {g} min
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              onRetime(start, every);
              setTiming(false);
            }}
            className="border px-3 text-[13px] font-medium"
            style={{
              minHeight: 40,
              borderRadius: 2,
              borderColor: 'var(--accent)',
              background: 'var(--accent)',
              color: '#fff',
            }}
          >
            Lay out the day
          </button>
          <p className="w-full text-[11px]" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
            Gives every stop a start time in the order shown, evenly spaced from the first. A
            rough pass to nudge by hand after. Undo puts the old times back.
          </p>
        </div>
      )}

      <div className="px-3">
        {day.items.length === 0 ? (
          <p className="py-6 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
            Nothing planned yet
            <span className="mt-1 block text-[12px]">
              {active
                ? 'Add a stop below, or open the library and every Add lands here'
                : 'Pick this day above, then add places to it'}
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
                  clash={clash.has(i)}
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
            placeholder="Add your own: nap, fly home, anything"
            className="field flex-1"
          />
          <button
            type="submit"
            disabled={!customTitle.trim()}
            className="border px-3 text-[13px] disabled:opacity-30"
            style={{ minHeight: 40, borderRadius: 2, borderColor: 'var(--line)', color: 'var(--muted)' }}
          >
            Add
          </button>
        </form>
      </div>
    </section>
  );
}

/**
 * The hotel for one night. Clearing the name clears the stay: a hotel with no
 * name is not a booking, and leaving an empty husk behind would put an empty
 * line in the sheet's list of where you are sleeping.
 */
function StayFields({
  stay,
  onChange,
  onDone,
}: {
  stay?: Stay;
  onChange: (stay: Stay | undefined) => void;
  onDone: () => void;
}) {
  const set = (patch: Partial<Stay>) => {
    const next = { name: '', ...stay, ...patch };
    onChange(next.name.trim() ? next : undefined);
  };

  return (
    <>
      <label className="grid gap-1">
        <span className="eyebrow">Hotel</span>
        <input
          className="field zh"
          placeholder="Wanda Realm Hangzhou"
          value={stay?.name ?? ''}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>

      <label className="grid gap-1">
        <span className="eyebrow">Address</span>
        <input
          className="field zh"
          placeholder="上城区 Jiefang Rd ..."
          value={stay?.address ?? ''}
          onChange={(e) => set({ address: e.target.value || undefined })}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <label className="grid gap-1">
          <span className="eyebrow">Check in</span>
          <input
            type="time"
            className="field"
            value={stay?.checkIn ?? ''}
            onChange={(e) => set({ checkIn: e.target.value || undefined })}
          />
        </label>
        <label className="grid gap-1">
          <span className="eyebrow">Phone</span>
          <input
            className="field w-44"
            placeholder="+86 571 ..."
            value={stay?.phone ?? ''}
            onChange={(e) => set({ phone: e.target.value || undefined })}
          />
        </label>
        <label className="grid gap-1">
          <span className="eyebrow">Booking ref</span>
          <input
            className="field w-36"
            placeholder="ABC123"
            value={stay?.ref ?? ''}
            onChange={(e) => set({ ref: e.target.value || undefined })}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onDone}
          className="border px-3 text-[13px]"
          style={{ minHeight: 38, borderRadius: 2, borderColor: 'var(--line)', color: 'var(--muted)', background: 'var(--card)' }}
        >
          Done
        </button>
        <p className="text-[11px]" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
          Set the same hotel on each night you are there. The sheet runs them together.
        </p>
      </div>
    </>
  );
}
