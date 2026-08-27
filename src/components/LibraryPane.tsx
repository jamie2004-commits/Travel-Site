import { useMemo, useState } from 'react';
import type { Category, City, Place } from '../types';
import { places as allPlaces } from '../data/places';
import { districts as allDistricts } from '../data/districts';
import { CATEGORY_LABELS, CITY_LABELS } from '../lib/format';
import PlaceCard from './PlaceCard';

interface Props {
  city: City;
  onCityChange: (city: City) => void;
  /** placeId -> how many times it sits in the itinerary. */
  usage?: Record<string, number>;
  onAdd?: (place: Place, event: React.MouseEvent) => void;
  renderCard?: (place: Place, card: React.ReactNode) => React.ReactNode;
}

const CATEGORIES: (Category | 'all')[] = ['all', 'food', 'sight', 'activity', 'shopping'];

export default function LibraryPane({ city, onCityChange, usage, onAdd, renderCard }: Props) {
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [district, setDistrict] = useState('all');
  const [query, setQuery] = useState('');

  const districts = useMemo(() => allDistricts.filter((d) => d.city === city), [city]);
  const districtsById = useMemo(
    () => Object.fromEntries(allDistricts.map((d) => [d.id, d])),
    [],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allPlaces.filter((p) => {
      if (p.city !== city) return false;
      if (category !== 'all' && p.category !== category) return false;
      if (district !== 'all' && p.district !== district) return false;
      if (!q) return true;
      return (
        p.nameZh.toLowerCase().includes(q) ||
        p.nameEn.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [city, category, district, query]);

  // A district tab with nothing behind it under the current filters is noise.
  const districtCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of allPlaces) {
      if (p.city !== city) continue;
      if (category !== 'all' && p.category !== category) continue;
      counts[p.district] = (counts[p.district] ?? 0) + 1;
    }
    return counts;
  }, [city, category]);

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Place library">
      <div
        className="shrink-0 border-b px-4 pt-4 pb-3"
        style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}
      >
        <div className="mb-3 flex gap-2">
          {(['shanghai', 'hangzhou'] as City[]).map((c) => {
            const active = c === city;
            return (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onCityChange(c);
                  setDistrict('all');
                }}
                aria-pressed={active}
                className="zh flex-1 border px-4 text-[17px] font-semibold"
                style={{
                  minHeight: 44,
                  borderRadius: 2,
                  borderColor: active ? 'var(--accent)' : 'var(--line)',
                  background: active ? 'var(--accent)' : 'var(--card)',
                  color: active ? '#fff' : 'var(--muted)',
                }}
              >
                {CITY_LABELS[c].zh}
                <span
                  className="ml-2 text-[11px] font-normal tracking-widest uppercase"
                  style={{ fontFamily: 'var(--font-sans)' }}
                >
                  {CITY_LABELS[c].en}
                </span>
              </button>
            );
          })}
        </div>

        <label className="sr-only" htmlFor="library-search">
          Search places
        </label>
        <input
          id="library-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索  Search names and tags"
          className="field mb-3 w-full"
          style={{ background: 'var(--card)' }}
        />

        <div className="mb-2 flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => {
            const active = c === category;
            return (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setCategory(c);
                  setDistrict('all');
                }}
                aria-pressed={active}
                className="zh border px-3 text-[15px]"
                style={{
                  minHeight: 38,
                  borderRadius: 2,
                  borderColor: active ? 'var(--accent)' : 'var(--line)',
                  background: active ? 'var(--accent-soft)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--muted)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {CATEGORY_LABELS[c].zh}
                <span
                  className="ml-1.5 text-[11px]"
                  style={{ fontFamily: 'var(--font-sans)', color: 'var(--muted)' }}
                >
                  {CATEGORY_LABELS[c].en}
                </span>
              </button>
            );
          })}
        </div>

        <label className="sr-only" htmlFor="library-district">
          District
        </label>
        <select
          id="library-district"
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
          className="field zh w-full text-[15px]"
          style={{ background: 'var(--card)' }}
        >
          <option value="all">全部区域 · All districts</option>
          {districts
            .filter((d) => districtCounts[d.id])
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.nameZh} · {d.nameEn} ({districtCounts[d.id]})
              </option>
            ))}
        </select>

        <p className="mt-2 text-[11px] tracking-[0.18em] uppercase" style={{ color: 'var(--muted)' }}>
          {results.length} {results.length === 1 ? 'place' : 'places'}
        </p>
      </div>

      <div className="pane flex-1 px-4 py-4">
        {results.length === 0 ? (
          <p className="py-10 text-center text-[14px]" style={{ color: 'var(--muted)' }}>
            没有结果
            <span className="ml-2" style={{ fontFamily: 'var(--font-sans)' }}>
              Nothing matches these filters
            </span>
          </p>
        ) : (
          <div className="grid gap-3">
            {results.map((place) => {
              const card = (
                <PlaceCard
                  place={place}
                  district={districtsById[place.district]}
                  usedCount={usage?.[place.id] ?? 0}
                  onAdd={onAdd}
                />
              );
              return (
                <div key={place.id}>{renderCard ? renderCard(place, card) : card}</div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
