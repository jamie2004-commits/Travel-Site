import { useEffect, useMemo, useRef, useState } from 'react';
import type { Category, City, Place } from '../types';
import { useCatalog } from '../lib/CatalogContext';
import { newUserPlaceId } from '../lib/userPlaces';
import { CATEGORY_LABELS, CITY_LABELS } from '../lib/format';

interface Props {
  city: City;
  /** Fixed by the button that opened the form, so it is not asked twice. */
  category?: Category;
  /**
   * The headings on the page, each with the tag that files a place under it.
   * Supplied by the activities page; absent from the library, which shows no
   * headings of its own.
   */
  sections?: { title: string; tag: string }[];
  onSave: (place: Place) => void;
  onCancel: () => void;
}

/** The option that reveals a text box for a heading that does not exist yet. */
const NEW_SECTION = '__new__';

const CATEGORIES: Category[] = ['food', 'sight', 'activity', 'shopping'];

const asNumber = (v: string) => (v.trim() === '' ? undefined : Math.max(0, Number(v)));

export default function AddPlaceDialog({
  city: initialCity,
  category: fixedCategory,
  sections,
  onSave,
  onCancel,
}: Props) {
  const { catalog } = useCatalog();
  const firstField = useRef<HTMLInputElement>(null);

  const [city, setCity] = useState<City>(initialCity);
  const [nameZh, setNameZh] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [category, setCategory] = useState<Category>(fixedCategory ?? 'food');
  /** The tag that files this place under a heading, or NEW_SECTION. */
  const [section, setSection] = useState<string>(sections?.[0]?.tag ?? '');
  const [newSection, setNewSection] = useState('');
  const [district, setDistrict] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [metro, setMetro] = useState('');
  const [addressZh, setAddressZh] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');

  const districts = useMemo(
    () => catalog.districts.filter((d) => d.city === city),
    [catalog.districts, city],
  );

  // Keep the district valid when the city changes under it.
  useEffect(() => {
    if (!districts.some((d) => d.id === district)) {
      setDistrict(districts[0]?.id ?? '');
    }
  }, [districts, district]);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const trimmedZh = nameZh.trim();
  const trimmedEn = nameEn.trim();
  const min = asNumber(priceMin);
  const max = asNumber(priceMax);
  // The database rejects a high price below the low one, and the message it
  // gives names a constraint. Cheaper to refuse it here, where both boxes are.
  const priceOutOfOrder = min !== undefined && max !== undefined && min > max;
  const sectionNamed = section !== NEW_SECTION || newSection.trim().length > 0;
  const canSave =
    Boolean((trimmedZh || trimmedEn) && district) && !priceOutOfOrder && sectionNamed;

  function save() {
    if (!canSave) return;
    const min = asNumber(priceMin);
    const max = asNumber(priceMax);
    onSave({
      id: newUserPlaceId(),
      nameZh: trimmedZh || trimmedEn,
      nameEn: trimmedEn || trimmedZh,
      city,
      district,
      category,
      description: description.trim(),
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      priceMin: min,
      // A single figure entered on the left reads as an exact price.
      priceMax: max ?? min,
      addressZh: addressZh.trim() || undefined,
      metro: metro.trim() || undefined,
      durationMinutes: asNumber(durationMinutes),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: 'rgba(18,33,31,.45)' }}
      onClick={onCancel}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Add a place"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex max-h-[92vh] w-full max-w-lg flex-col gap-3 overflow-y-auto border p-4"
        style={{ background: 'var(--card)', borderColor: 'var(--line)', borderRadius: 2 }}
      >
        <div>
          <p className="eyebrow">Add a place</p>
          <h2 className="text-[20px] font-semibold">Add a place</h2>
        </div>

        <div className="flex gap-2">
          {(['shanghai', 'hangzhou'] as City[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCity(c)}
              aria-pressed={c === city}
              className="flex-1 border text-[15px]"
              style={{
                minHeight: 42,
                borderRadius: 2,
                borderColor: c === city ? 'var(--accent)' : 'var(--line)',
                background: c === city ? 'var(--accent)' : 'transparent',
                color: c === city ? '#fff' : 'var(--muted)',
              }}
            >
              {CITY_LABELS[c]}
            </button>
          ))}
        </div>

        <label className="grid gap-1">
          <span className="eyebrow">Chinese name</span>
          <input ref={firstField} className="field zh" value={nameZh} onChange={(e) => setNameZh(e.target.value)} />
        </label>

        <label className="grid gap-1">
          <span className="eyebrow">English name</span>
          <input className="field" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </label>

        {/*
          The section is the heading this place appears under, and the page
          decides that by reading a place's first tag. So choosing a section
          and setting that tag are the same act, and this hides it.

          Only offered where there are headings to offer: the activities page
          passes them, the library has none of its own.
        */}
        {sections && sections.length > 0 && (
          <label className="grid gap-1">
            <span className="eyebrow">Section</span>
            <select
              className="field"
              value={section}
              onChange={(e) => setSection(e.target.value)}
            >
              {sections.map((s) => (
                <option key={s.tag} value={s.tag}>
                  {s.title}
                </option>
              ))}
              <option value={NEW_SECTION}>+ New section…</option>
            </select>
            {section === NEW_SECTION && (
              <input
                className="field mt-1"
                value={newSection}
                onChange={(e) => setNewSection(e.target.value)}
                placeholder="What to call it, like Rock climbing"
                aria-label="New section name"
              />
            )}
            <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
              {section === NEW_SECTION
                ? 'A new heading appears on the page as soon as this place is in it.'
                : 'Where it shows up on this page.'}
            </span>
          </label>
        )}

        <div className="flex flex-wrap gap-2">
          {/* Fixed by the button that opened this, so it is not asked twice. */}
          {!fixedCategory && (
          <label className="grid flex-1 gap-1">
            <span className="eyebrow">Category</span>
            <select
              className="field"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          )}
          <label className="grid flex-1 gap-1">
            <span className="eyebrow">District</span>
            <select
              className="field"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
            >
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nameEn}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="grid gap-1">
          <span className="eyebrow">Description</span>
          <textarea
            className="field"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <label className="grid gap-1">
          <span className="eyebrow">Tags, comma separated</span>
          <input className="field" value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>

        <div className="flex flex-wrap gap-2">
          <label className="grid gap-1">
            <span className="eyebrow">Price low</span>
            <input type="number" min={0} className="field w-24" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="eyebrow">Price high</span>
            <input type="number" min={0} className="field w-24" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="eyebrow">Minutes</span>
            <input type="number" min={0} step={15} className="field w-24" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
          </label>
        </div>

        <label className="grid gap-1">
          <span className="eyebrow">Nearest metro</span>
          <input className="field" value={metro} onChange={(e) => setMetro(e.target.value)} />
        </label>

        <label className="grid gap-1">
          <span className="eyebrow">Address</span>
          <input className="field zh" value={addressZh} onChange={(e) => setAddressZh(e.target.value)} />
        </label>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 border text-[14px]"
            style={{ minHeight: 44, borderRadius: 2, borderColor: 'var(--line)' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="flex-1 text-[14px] font-semibold text-white disabled:opacity-30"
            style={{ minHeight: 44, borderRadius: 2, background: 'var(--accent)' }}
          >
            Save
          </button>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
          Saved in this browser. The Supabase catalog is read only until there is a sign in.
        </p>
      </form>
    </div>
  );
}
