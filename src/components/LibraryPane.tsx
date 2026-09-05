import { useMemo, useState } from 'react';
import type { Category, City, Day, Place } from '../types';
import { useCatalog } from '../lib/CatalogContext';
import { CATEGORY_LABELS, CITY_LABELS } from '../lib/format';
import PlaceCard from './PlaceCard';
import AddPlaceDialog from './AddPlaceDialog';
import ConfirmDialog from './ConfirmDialog';
import { canEditPlace, isLocalPlace } from '../lib/userPlaces';
import { useIdentity } from '../lib/IdentityContext';
import { dayCities } from '../lib/schedule';
import { cloudAvailable } from '../lib/identity';

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
  /** Told after a place is deleted, so stops pointing at it can be detached. */
  onPlaceDeleted?: (place: Place) => void;
}

const CATEGORIES: (Category | 'all')[] = ['all', 'food', 'sight', 'activity', 'shopping'];

/**
 * What deleting actually does, which differs by where the place lives, and
 * what it does to the trip, which the user cannot see from the library.
 */
function deleteBody(place: Place, inTrip: number): string {
  const where = isLocalPlace(place)
    ? 'This removes it from this browser. Nothing else is affected.'
    : 'This removes it from the database, for everyone. It cannot be undone.';
  if (!inTrip) return where;
  const times = inTrip === 1 ? 'once' : `${inTrip} times`;
  return `${where} It is in your trip ${times}. Those stops stay where they are, keeping their times and notes, but they stop being linked to the catalog.`;
}

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
  onPlaceDeleted,
}: Props) {
  const { catalog, loading, error, addPlace, removePlace } = useCatalog();
  const allPlaces = catalog.places;
  const allDistricts = catalog.districts;
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [district, setDistrict] = useState('all');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const { userId } = useIdentity();
  const [pendingDelete, setPendingDelete] = useState<Place | null>(null);
  const [deleting, setDeleting] = useState(false);

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
                className="flex-1 border px-4 text-[17px] font-semibold"
                style={{
                  minHeight: 44,
                  borderRadius: 2,
                  borderColor: active ? 'var(--accent)' : 'var(--line)',
                  background: active ? 'var(--accent)' : 'var(--card)',
                  color: active ? '#fff' : 'var(--muted)',
                }}
              >
                {CITY_LABELS[c]}
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
            <span className="text-[13px]" style={{ color: 'var(--ink)' }}>
              {activeDay?.label} is in {CITY_LABELS[elsewhere]}
            </span>
            <span className="ml-2">Switch the library over.</span>
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
          placeholder="Search names and tags"
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
                className="border px-3 text-[15px]"
                style={{
                  minHeight: 38,
                  borderRadius: 2,
                  borderColor: active ? 'var(--accent)' : 'var(--line)',
                  background: active ? 'var(--accent-soft)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--muted)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {CATEGORY_LABELS[c]}
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
          className="field w-full text-[15px]"
          style={{ background: 'var(--card)' }}
        >
          <option value="all">All districts</option>
          {districts
            .filter((d) => districtCounts[d.id])
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.nameEn} ({districtCounts[d.id]})
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
        {/*
          Which catalog is on screen. Both sources look identical, so without
          this the only way to tell them apart is to read the network log.
        */}
        {!loading && !error && (
          <p className="mt-1 text-[11px]" style={{ lineHeight: 1.5 }}>
            {catalog.origin === 'supabase' ? (
              <span style={{ color: 'var(--accent)' }}>
                Live from the database
              </span>
            ) : cloudAvailable ? (
              <span style={{ color: 'var(--muted)' }}>Built-in catalog</span>
            ) : (
              <span style={{ color: 'var(--plum)' }}>
                Built-in catalog · the database is not connected to this build, so
                anything added stays in this browser
              </span>
            )}
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
          Add a place
        </button>
      </div>

      <div className="pane flex-1 px-4 py-4">
        {results.length === 0 ? (
          <p className="py-10 text-center text-[14px]" style={{ color: 'var(--muted)' }}>
            Nothing matches these filters
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
                  onRemove={canEditPlace(place, userId) ? () => setPendingDelete(place) : undefined}
                />
              );
              return (
                <div key={place.id}>{renderCard ? renderCard(place, card) : card}</div>
              );
            })}
          </div>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.nameEn || pendingDelete.nameZh}`}
          body={deleteBody(pendingDelete, usage?.[pendingDelete.id] ?? 0)}
          confirmLabel={deleting ? 'Deleting' : 'Delete'}
          onConfirm={() => {
            if (deleting) return;
            const place = pendingDelete;
            setDeleting(true);
            void removePlace(place).then((result) => {
              setDeleting(false);
              setPendingDelete(null);
              // Only detach when it really went. A refused delete must leave
              // the trip alone, or the stop loses its link for nothing.
              if (result.ok) onPlaceDeleted?.(place);
              onAdded?.(result.message);
            });
          }}
          onCancel={() => !deleting && setPendingDelete(null)}
        />
      )}

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
                  ? `${result.message} · saved to the database`
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
