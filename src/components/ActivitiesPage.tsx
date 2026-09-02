import { useEffect, useMemo, useRef, useState } from 'react';
import type { City, Day, Place } from '../types';
import { useCatalog } from '../lib/CatalogContext';
import { CITY_LABELS, formatDuration, formatPrice } from '../lib/format';
import { dayNumberOffset } from '../lib/days';

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
 * What a group is: a heading, a line on the kind, and the source categories
 * that land in it. The key is the first tag on a place, which is the category
 * its guide filed it under, so a kind nobody has mapped yet lands in
 * "Everything else" rather than disappearing off the page.
 */
interface Group {
  id: string;
  title: string;
  blurb: string;
  kinds: string[];
}

const DOING: Group[] = [
  {
    id: 'classics',
    title: 'Old streets and heritage',
    blurb:
      'The Hangzhou that is not the lake: a canal street people still live on, a Southern Song palace excavated where it stood, and a 5,000-year-old walled city out at Liangzhu. Most of these are free and most want booking the day before.',
    kinds: ['Old Street', 'Heritage Site', 'Museum'],
  },
  {
    id: 'outdoors',
    title: 'Walks and parks',
    blurb:
      'Where the city goes at the weekend. Two of these are seasonal and worth planning around: blossom at Taiziwan in late March, osmanthus at Manjuelong for three weeks in autumn. The valley walks are good in any weather.',
    kinds: ['Hike', 'Park'],
  },
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

/**
 * Food groups by the meal you are deciding on, not by the label the guide
 * printed. Thirty-eight cuisine tags across fifty-odd restaurants is a filing
 * system, not a way to choose dinner.
 */
const EATING: Group[] = [
  {
    id: 'dumplings',
    title: 'Dumplings and buns',
    blurb:
      'The thing to eat first. Shengjianbao splits into two schools and the city argues about them: hunshui, juicy and soup-filled, against the clear-water style with fluffy dough and no soup inside. Xiaolongbao is the other one, sipped through the skin before you eat it.',
    kinds: ['Shengjianbao', 'Xiaolongbao', 'Dim Sum / Snacks', 'Must Try'],
  },
  {
    id: 'noodles',
    title: 'Noodles',
    blurb:
      'Cheap, fast, and where the locals actually eat. A bowl runs ¥30 to ¥70, queues move, and nobody minds you eating alone.',
    kinds: ['Noodles', 'Noodle Shop'],
  },
  {
    id: 'local',
    title: 'Shanghainese and Hangzhou classics',
    blurb:
      'Benbang cai in Shanghai, sweet and red-braised. Across in Hangzhou it turns lighter and lake-facing: Dongpo pork, beggar\u2019s chicken, vinegar fish. This is the food the cities are actually about.',
    kinds: [
      'Benbang Cai',
      'Home-style',
      'Hangzhou',
      'Historic',
      'Local',
      'Xiaoshan',
      'New Zhejiang',
      'Jiangnan',
      'Private Kitchen',
      'Nostalgic',
    ],
  },
  {
    id: 'regional',
    title: 'From elsewhere in China',
    blurb:
      'Both cities pull cooking in from everywhere else: Sichuan, Hunan, Chaozhou, Fujian, Quzhou, and lamb skewers from the Inner Mongolian grasslands at three in the morning.',
    kinds: [
      'Cantonese',
      'Sichuan',
      'Hunan',
      'Fujian',
      'Wenzhou',
      'Quzhou',
      'Chaozhou',
      'Seafood',
      'BBQ / Skewers',
      'Vegetarian',
      'Creative Chinese',
    ],
  },
  {
    id: 'fine',
    title: 'Worth booking ahead',
    blurb:
      'Michelin stars, an Asia\u2019s 50 Best room inside a botanical garden, and tasting menus that want two weeks\u2019 notice. Lunch sets are far cheaper than dinner for the same kitchen.',
    kinds: ['Fine Dining'],
  },
  {
    id: 'western',
    title: 'Cafés, bars and Western',
    blurb:
      'The French Concession does this properly: natural wine, galettes, a teddy bear cafe with a queue. Useful when the group has had enough rice.',
    kinds: ['Cafe', 'Bakery', 'French', 'Fusion', 'Rooftop', 'Concept'],
  },
  {
    id: 'streets',
    title: 'Streets, markets and seasons',
    blurb:
      'Where you go without a booking: a food street that stays open late, a mall floor of the brands everyone queues for, and the autumn hairy crab that only exists for two months.',
    kinds: ['Food Street', 'Multi', 'Food Tour', 'Seasonal'],
  },
];

const OTHER: Group = { id: 'other', title: 'Everything else', blurb: '', kinds: [] };

/** The two halves of the page: what you do, and what you eat. */
const MODES = {
  do: {
    label: 'Things to do',
    title: 'Activities',
    kicker: 'things to do',
    category: 'activity' as const,
    groups: DOING,
    lede:
      'Everything in the library that is a thing to do rather than a thing to see or eat, at a size you can actually read. Pick the day you are filling, then add as you go \u2014 it lands in the itinerary and you carry on reading.',
    unit: 'to do',
  },
  eat: {
    label: 'Food',
    title: 'Food',
    kicker: 'where to eat',
    category: 'food' as const,
    groups: EATING,
    lede:
      'Every restaurant, noodle shop and cafe in the library, grouped by the meal you are deciding on rather than by district. Prices are per person, and the nearest metro is on every card because that is what decides whether you go.',
    unit: 'places',
  },
};

type Mode = keyof typeof MODES;

function groupOf(place: Place, groups: Group[]) {
  const kind = place.tags[0] ?? '';
  return groups.find((g) => g.kinds.includes(kind))?.id ?? OTHER.id;
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
  const [mode, setMode] = useState<Mode>('do');
  const root = useRef<HTMLDivElement>(null);
  const view = MODES[mode];

  const shown = useMemo(
    () => catalog.places.filter((p) => p.category === view.category && p.city === city),
    [catalog.places, view.category, city],
  );

  // Only cities with something to show, so the toggle never leads to an empty page.
  const cities = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of catalog.places) {
      if (p.category === view.category) counts[p.city] = (counts[p.city] ?? 0) + 1;
    }
    return counts;
  }, [catalog.places, view.category]);

  // On the tab you are not looking at, so the switch can say what is over there.
  const modeCounts = useMemo(() => {
    const counts = { do: 0, eat: 0 } as Record<Mode, number>;
    for (const p of catalog.places) {
      if (p.city !== city) continue;
      if (p.category === MODES.do.category) counts.do += 1;
      if (p.category === MODES.eat.category) counts.eat += 1;
    }
    return counts;
  }, [catalog.places, city]);

  const sections = useMemo(() => {
    const buckets = new Map<string, Place[]>();
    for (const place of shown) {
      const id = groupOf(place, view.groups);
      if (!buckets.has(id)) buckets.set(id, []);
      buckets.get(id)!.push(place);
    }
    return [...view.groups, OTHER]
      .filter((g) => buckets.get(g.id)?.length)
      .map((g) => ({ ...g, places: buckets.get(g.id)! }));
  }, [shown, view.groups]);

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

  const dayOffset = dayNumberOffset(days);

  const jump = (id: string) =>
    root.current?.querySelector(`#g-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="acts" ref={root}>
      <header className="acts-hero">
        <div className="acts-wrap">
          <div className="acts-topline">
            <p className="eyebrow">
              {CITY_LABELS[city]} · {view.kicker}
            </p>
            <div className="acts-jumpto">
              <button type="button" onClick={onBuild}>
                Back to the editor
              </button>
              <button type="button" onClick={onSheet}>
                The sheet
              </button>
            </div>
          </div>

          <h1>{view.title}</h1>
          <p className="acts-lede">{view.lede}</p>

          <div className="acts-modes" role="tablist" aria-label="What to browse">
            {(Object.keys(MODES) as Mode[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={key === mode}
                className={key === mode ? 'on' : undefined}
                onClick={() => setMode(key)}
              >
                {MODES[key].label} <span>{modeCounts[key]}</span>
              </button>
            ))}
          </div>

          <div className="acts-counts">
            <span>
              <b>{shown.length}</b> {view.unit}
            </span>
            <span>
              <b>{sections.length}</b> kinds
            </span>
            <span>
              <b>{shown.filter((p) => usage[p.id]).length}</b> already in the trip
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
                    Day {i + dayOffset} · {d.label}
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

        {shown.length === 0 && (
          <p className="acts-empty">
            Nothing in the library for {CITY_LABELS[city]} yet. Add a place in the builder and it
            shows up here.
          </p>
        )}
      </main>

      <footer className="acts-foot">
        <button type="button" onClick={onBuild}>
          Back to the editor
        </button>
        <p>
          {mode === 'do'
            ? 'Prices are per person and move with the season. Book the popular rooms ahead.'
            : 'Prices are per person and move with the season. The queue-worthy places are worth arriving early for, not late.'}
        </p>
      </footer>
    </div>
  );
}
