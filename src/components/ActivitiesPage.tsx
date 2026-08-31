import { useEffect, useMemo, useRef, useState } from 'react';
import type { City, Day, Place } from '../types';
import { useCatalog } from '../lib/CatalogContext';
import { CITY_LABELS, formatDuration, formatPrice } from '../lib/format';

interface Props {
  days: Day[];
  /** The day an add lands in, shared with the builder. */
  activeDayId: string | null;
  onSelectDay: (dayId: string) => void;
  onAdd: (place: Place, dayId: string) => void;
  /** placeId -> how many times it sits anywhere in the trip. */
  usage: Record<string, number>;
  onBuild: () => void;
  onSheet: () => void;
}

/**
 * The kinds of activity, in the order they read. The key is the first tag on
 * a place, which is the category the source guide filed it under, so a new
 * kind arriving in the catalog lands in "Everything else" rather than
 * disappearing.
 */
const GROUPS: { id: string; title: string; blurb: string; kinds: string[] }[] = [
  {
    id: 'escape',
    title: 'Escape rooms',
    blurb:
      'Shanghai runs some of the best in the world: story first, built like film sets, and long past the padlock-in-a-basement era. Two to three hours, best in a group of four to six. Ask about English support when you book.',
    kinds: ['Escape Room'],
  },
  {
    id: 'karting',
    title: 'Go-karting',
    blurb:
      'From the actual Formula One circuit out in Jiading to a track on a mall roof. Book ahead at weekends, and take the single-seater on a first visit.',
    kinds: ['Go-Karting'],
  },
  {
    id: 'immersive',
    title: 'Immersive and VR',
    blurb:
      'Theatre you walk through, headsets you disappear into, and one show that hands you an Apple Vision Pro. The strongest of these are closer to an evening out than an arcade.',
    kinds: ['Immersive Theatre', 'Immersive', 'VR', 'VR Arcade', 'VR Theme Park', 'Mixed Reality'],
  },
  {
    id: 'nights',
    title: 'Nights out',
    blurb:
      'The river after dark, a stage, a rooftop, a jazz room. Most of this is walkable from the Bund, so an evening can hold two of them.',
    kinds: ['Cruise', 'Show', 'Bar', 'Music', 'Nightlife'],
  },
  {
    id: 'games',
    title: 'Lanes and ranges',
    blurb: 'Bowling and archery, for the hours when the weather decides for you.',
    kinds: ['Bowling', 'Archery'],
  },
  {
    id: 'slow',
    title: 'Slow it down',
    blurb:
      'The two-yuan ferry that beats every skyline cruise, and the massage that is the correct decision the night before a theme park.',
    kinds: ['Transport', 'Wellness'],
  },
];

const OTHER = { id: 'other', title: 'Everything else', blurb: '' };

function groupOf(place: Place) {
  const kind = place.tags[0] ?? '';
  return GROUPS.find((g) => g.kinds.includes(kind))?.id ?? OTHER.id;
}

/** The badge the guides shout in capitals, e.g. "#1 RANKED". */
const badgeOf = (place: Place) =>
  place.tags.find((t, i) => i > 0 && t === t.toUpperCase() && /[A-Z]/.test(t));

export default function ActivitiesPage({
  days,
  activeDayId,
  onSelectDay,
  onAdd,
  usage,
  onBuild,
  onSheet,
}: Props) {
  const { catalog } = useCatalog();
  const [city, setCity] = useState<City>('shanghai');
  const root = useRef<HTMLDivElement>(null);

  const activities = useMemo(
    () => catalog.places.filter((p) => p.category === 'activity' && p.city === city),
    [catalog.places, city],
  );

  // Only cities with something to show, so the toggle never leads to an empty page.
  const cities = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of catalog.places) {
      if (p.category === 'activity') counts[p.city] = (counts[p.city] ?? 0) + 1;
    }
    return counts;
  }, [catalog.places]);

  const sections = useMemo(() => {
    const buckets = new Map<string, Place[]>();
    for (const place of activities) {
      const id = groupOf(place);
      if (!buckets.has(id)) buckets.set(id, []);
      buckets.get(id)!.push(place);
    }
    return [...GROUPS, OTHER]
      .filter((g) => buckets.get(g.id)?.length)
      .map((g) => ({ ...g, places: buckets.get(g.id)! }));
  }, [activities]);

  // The builder tints itself per city; this page is a city at a time, so it
  // carries the same tint rather than whichever one the builder left behind.
  useEffect(() => {
    document.documentElement.dataset.city = city;
  }, [city]);

  const activeDay = days.find((d) => d.id === activeDayId) ?? days[0] ?? null;
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(null), 2200);
    return () => clearTimeout(t);
  }, [added]);

  const jump = (id: string) =>
    root.current?.querySelector(`#g-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="acts" ref={root}>
      <header className="acts-hero">
        <div className="acts-wrap">
          <div className="acts-topline">
            <p className="eyebrow">{CITY_LABELS[city]} · things to do</p>
            <div className="acts-jumpto">
              <button type="button" onClick={onBuild}>
                Back to the builder
              </button>
              <button type="button" onClick={onSheet}>
                The sheet
              </button>
            </div>
          </div>

          <h1>Activities</h1>
          <p className="acts-lede">
            Everything in the library that is a thing to do rather than a thing to see or eat, at a
            size you can actually read. Pick the day you are filling, then add as you go — it lands
            in the itinerary and you carry on reading.
          </p>

          <div className="acts-counts">
            <span>
              <b>{activities.length}</b> to do
            </span>
            <span>
              <b>{sections.length}</b> kinds
            </span>
            <span>
              <b>{activities.filter((p) => usage[p.id]).length}</b> already in the trip
            </span>
          </div>
        </div>
      </header>

      <nav className="acts-nav">
        <div className="acts-wrap acts-navrow">
          <div className="acts-cities">
            {(['shanghai', 'hangzhou'] as City[])
              .filter((c) => cities[c])
              .map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={c === city}
                  className={c === city ? 'on' : undefined}
                  onClick={() => setCity(c)}
                >
                  {CITY_LABELS[c]} <span>{cities[c]}</span>
                </button>
              ))}
          </div>

          <div className="acts-links">
            {sections.map((s) => (
              <button key={s.id} type="button" onClick={() => jump(s.id)}>
                {s.title} <span>{s.places.length}</span>
              </button>
            ))}
          </div>

          {days.length > 0 && (
            <label className="acts-day">
              <span className="eyebrow">Adding to</span>
              <select
                value={activeDay?.id ?? ''}
                onChange={(e) => onSelectDay(e.target.value)}
                className="field"
              >
                {days.map((d, i) => (
                  <option key={d.id} value={d.id}>
                    Day {i + 1} · {d.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </nav>

      <main className="acts-wrap">
        {sections.map((section) => (
          <section className="acts-group" id={`g-${section.id}`} key={section.id}>
            <div className="acts-grouphead">
              <h2>{section.title}</h2>
              <span className="acts-count">{section.places.length}</span>
            </div>
            {section.blurb && <p className="acts-blurb">{section.blurb}</p>}

            <div className="acts-list">
              {section.places.map((place) => {
                const district = catalog.districtById[place.district];
                const badge = badgeOf(place);
                // The kind heads the section and the badge heads the card, so
                // neither is repeated in the chips underneath.
                const chips = place.tags.slice(1).filter((t) => t !== badge);
                const inTrip = usage[place.id] ?? 0;
                const duration = formatDuration(place.durationMinutes);
                return (
                  <article className="act" key={place.id}>
                    <div className="act-body">
                      <p className="act-kicker">
                        {place.tags[0]}
                        {badge && <b> · {badge}</b>}
                        {inTrip > 0 && (
                          <em>
                            {' '}
                            · in the trip {inTrip > 1 ? `${inTrip} times` : 'already'}
                          </em>
                        )}
                      </p>
                      <h3>{place.nameZh}</h3>
                      {place.nameEn !== place.nameZh && <p className="act-en">{place.nameEn}</p>}
                      <p className="act-desc">{place.description}</p>
                      {chips.length > 0 && (
                        <ul className="act-tags">
                          {chips.map((tag) => (
                            <li key={tag}>{tag}</li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <aside className="act-meta">
                      <dl>
                        <div>
                          <dt>Price</dt>
                          <dd className="act-price">{formatPrice(place.priceMin, place.priceMax)}</dd>
                        </div>
                        {duration && (
                          <div>
                            <dt>Time</dt>
                            <dd>{duration}</dd>
                          </div>
                        )}
                        {district && (
                          <div>
                            <dt>Where</dt>
                            <dd>{district.nameEn}</dd>
                          </div>
                        )}
                        {place.metro && (
                          <div>
                            <dt>Metro</dt>
                            <dd>{place.metro}</dd>
                          </div>
                        )}
                        {place.addressZh && place.addressZh !== place.metro && (
                          <div>
                            <dt>Address</dt>
                            <dd>{place.addressZh}</dd>
                          </div>
                        )}
                      </dl>

                      {activeDay && (
                        <button
                          type="button"
                          className="act-add"
                          onClick={() => {
                            onAdd(place, activeDay.id);
                            setAdded(place.id);
                          }}
                        >
                          {added === place.id ? `Added to ${activeDay.label}` : `Add to ${activeDay.label}`}
                        </button>
                      )}
                    </aside>
                  </article>
                );
              })}
            </div>
          </section>
        ))}

        {activities.length === 0 && (
          <p className="acts-empty">
            Nothing in the library for {CITY_LABELS[city]} yet. Add a place in the builder and it
            shows up here.
          </p>
        )}
      </main>

      <footer className="acts-foot">
        <button type="button" onClick={onBuild}>
          Back to the builder
        </button>
        <p>Prices are per person and move with the season. Book the popular rooms ahead.</p>
      </footer>
    </div>
  );
}
