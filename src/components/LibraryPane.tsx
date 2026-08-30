import { useMemo, useState } from 'react';
import type { Category, City, Day, Place } from '../types';
import { useCatalog } from '../lib/CatalogContext';
import { CATEGORY_LABELS, CITY_LABELS } from '../lib/format';
import PlaceCard from './PlaceCard';
import AddPlaceDialog from './AddPlaceDialog';
import { isUserPlace } from '../lib/userPlaces';
import { dayCities } from '../lib/schedule';

interface Props {
  city: City;
  onCityChange: (city: City) => void;
  /** placeId -> how many times it sits anywhere in the itinerary. */
  usage?: Record<string, number>;
  /** placeId -> how many times it sits in the day being planned. */
  dayUsage?: Record<string, number>;
  /** The day the add button fills. */
  activeDay?: Day | null;
  onAdd?: (place: Place) => void;
  onAddElsewhere?: (place: Place) => void;
  /** Told what happened after a new place was saved, to show a toast. */
  onAdded?: (message: string) => void;
  renderCard?: (place: Place, card: React.ReactNode) => React.ReactNode;
}

const CATEGORIES: (Category | 'all')[] = ['all', 'food', 'sight', 'activity', 'shopping'];

export default function LibraryPane({
  city,
  onCityChange,
  usage,
  dayUsage,
  activeDay,
  onAdd,
  onAddElsewhere,
  onAdded,
  renderCard,
}: Props) {
  const { catalog, loading, error, addPlace, removePlace } = useCatalog();
  const allPlaces = catalog.places;
  const allDistricts = catalog.districts;
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [district, setDistrict] = useState('all');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const districts = useMemo(
    () => allDistricts.filter((d) => d.city === city),
    [allDistricts, city],
  );
  const districtsById = catalog.districtById;

  // Filling a Hangzhou day off a Shanghai list is the quiet way to build a
  // trip that cannot be travelled, so say so before the add rather than after.
  const elsewhere = useMemo(() => {
    if (!activeDay) return undefined;
    const cities = dayCities(activeDay.items, catalog);
    return cities.length === 1 && cities[0] !== city ? cities[0] : undefined;
  }, [activeDay, catalog, city]);

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
  }, [allPlaces, city, category, district, query]);

  // A district tab with nothing behind it under the current filters is noise.
  const districtCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of allPlaces) {
      if (p.city !== city) continue;
      if (category !== 'all' && p.category !== category) continue;
      counts[p.district] = (counts[p.district] ?? 0) + 1;
    }
    return counts;
  }, [allPlaces, city, category]);

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

        {elsewhere && (
          <button
            type="button"
            onClick={() => {
              onCityChange(elsewhere);
              setDistrict('all');
            }}
            className="mb-3 w-full border border-dashed px-3 py-2 text-left text-[12px]"
            style={{ borderRadius: 2, borderColor: 'var(--accent2)', color: 'var(--muted)' }}
          >
            <span className="zh text-[13px]" style={{ color: 'var(--ink)' }}>
              {activeDay?.label} 在{CITY_LABELS[elsewhere].zh}
            </span>
            <span className="ml-2">
              This day is in {CITY_LABELS[elsewhere].en}. Switch the library over.
            </span>
          </button>
        )}

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
          {loading && <span style={{ opacity: 0.6 }}> · checking for updates</span>}
        </p>
        {error && (
          <p className="mt-1 text-[11px]" style={{ color: 'var(--plum)', lineHeight: 1.5 }}>
            Showing the bundled catalog. Supabase did not answer: {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 w-full border text-[14px]"
          style={{
            minHeight: 42,
            borderRadius: 2,
            borderColor: 'var(--line)',
            color: 'var(--ink)',
            background: 'var(--card)',
          }}
        >
          添加地点
          <span className="ml-2 text-[11px]" style={{ color: 'var(--muted)' }}>
            Add a place
          </span>
        </button>
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
                  usedHere={dayUsage?.[place.id] ?? 0}
                  usedTotal={usage?.[place.id] ?? 0}
                  activeDayLabel={activeDay?.label}
                  onAdd={onAdd}
                  onAddElsewhere={onAddElsewhere}
                  onRemove={isUserPlace(place) ? () => removePlace(place.id) : undefined}
                />
              );
              return (
                <div key={place.id}>{renderCard ? renderCard(place, card) : card}</div>
              );
            })}
          </div>
        )}
      </div>

      {adding && (
        <AddPlaceDialog
          city={city}
          onSave={(place) => {
            setAdding(false);
            void addPlace(place).then((result) => {
              // A refused write must not look like a success: the place is
              // not in the catalog, and saying so is the whole point.
              onAdded?.(
                result.ok && result.stored === 'supabase'
                  ? `${result.message} · 已存入資料庫`
                  : result.message,
              );
            });
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </section>
  );
}
