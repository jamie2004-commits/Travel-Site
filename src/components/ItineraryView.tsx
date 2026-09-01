import { useMemo, useRef } from 'react';
import type { Day, Itinerary } from '../types';
import { itemTitle, type Catalog } from '../lib/catalog';
import { useCatalog } from '../lib/CatalogContext';
import { formatPrice, sumCosts, CITY_LABELS } from '../lib/format';
import type { CostSum } from '../lib/format';
import { dayCities, dayWindow } from '../lib/schedule';
import { TRAVEL_MARKS, legName, legRoute, legTimes, travelLegs } from '../lib/travel';
import { nightsLabel, stayBlocks, stayDetails } from '../lib/stay';
import { dayNumberOffset, lastDayNumber } from '../lib/days';

interface Props {
  itinerary: Itinerary;
  onEdit: () => void;
  onActivities: () => void;
}

const money = (n: number) => `¥${n.toLocaleString('en-US')}`;

/** "¥230–400", with the count of unestimated stops left for the caller to say. */
function range(sum: CostSum): string {
  if (!sum.known) return 'No estimate';
  return sum.min === sum.max ? money(sum.min) : `${money(sum.min)}–${money(sum.max)}`;
}

/** "2026-09-17" to "17 / 09". Parsed as a plain date, no timezone in play. */
function dayNumber(date?: string, fallback?: string) {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]} / ${m[2]}` : (fallback ?? '');
}

/** "18/9", the compact form the nav row uses. */
function navDate(date?: string, fallback?: string) {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])}/${Number(m[2])}` : (fallback ?? '');
}

function weekday(date?: string) {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
}

function shortDate(date?: string) {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * A label the day has earned, rather than one written by hand. A day that
 * touches two cities is a transfer day whatever else is on it, so that wins.
 */
function dayTag(day: Day, catalog: Catalog): { text: string; tone: string } | undefined {
  const cities = dayCities(day.items, catalog);
  if (cities.length > 1) return { text: 'Transfer day', tone: 'gold' };
  const window = dayWindow(day.items);
  const span =
    window.from && window.to
      ? (Number(window.to.slice(0, 2)) * 60 + Number(window.to.slice(3))) -
        (Number(window.from.slice(0, 2)) * 60 + Number(window.from.slice(3)))
      : 0;
  if (day.items.length >= 7 || span >= 600) return { text: 'Full day out', tone: '' };
  if (day.items.length && day.items.length <= 2) return { text: 'Light day', tone: 'calm' };
  return undefined;
}

export default function ItineraryView({ itinerary, onEdit, onActivities }: Props) {
  const { catalog } = useCatalog();
  const root = useRef<HTMLDivElement>(null);
  const days = itinerary.days;
  const stops = days.reduce((n, d) => n + d.items.length, 0);
  const legs = travelLegs(days);
  const stays = stayBlocks(days);
  const dayOffset = dayNumberOffset(days);
  const lastDay = lastDayNumber(days);
  const grand = sumCosts(days.flatMap((d) => d.items));

  const cities = useMemo(() => {
    const seen: string[] = [];
    for (const day of days) {
      for (const c of dayCities(day.items, catalog)) if (!seen.includes(c)) seen.push(c);
    }
    return seen;
  }, [days, catalog]);

  const dated = days.filter((d) => d.date);
  const span =
    dated.length > 0
      ? `${shortDate(dated[0].date)}${dated.length > 1 ? ` to ${shortDate(dated[dated.length - 1].date)}` : ''}`
      : '';

  // Anchors rather than href, so jumping to a day never fights the route hash.
  const jump = (id: string) => {
    root.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const [nameStart, ...nameRest] = itinerary.name.split('/');

  return (
    <div className="sheet" ref={root}>
      <header>
        <div className="wrap">
          <div className="eyebrow">
            {span ? `${span} · ` : ''}
            {days.length} {days.length === 1 ? 'day' : 'days'}
            {stops ? ` · ${stops} stops` : ''}
          </div>
          <h1>
            {nameStart}
            {nameRest.map((part, i) => (
              <span key={i}>
                <span className="sep">/</span>
                {part}
              </span>
            ))}
          </h1>
          {cities.length > 0 && (
            <div className="sub">{cities.map((c) => CITY_LABELS[c]).join(' to ')}</div>
          )}

          <dl className="meta">
            <div>
              <dt>Dates</dt>
              <dd>{span || 'Not dated yet'}</dd>
            </div>
            <div>
              <dt>Days</dt>
              <dd>{days.length}</dd>
            </div>
            <div>
              <dt>Stops</dt>
              <dd>{stops}</dd>
            </div>
            <div>
              <dt>Per person</dt>
              <dd>{range(grand)}</dd>
            </div>
          </dl>

          <div className="heroactions">
            <button type="button" className="edit" onClick={onEdit}>
              Edit this trip
            </button>
            <button type="button" className="edit ghost" onClick={onActivities}>
              Activities
            </button>
            <button type="button" className="edit ghost" onClick={() => window.print()}>
              Print
            </button>
          </div>
        </div>
      </header>

      {days.length > 0 && (
        <nav>
          <div className="navrow">
            {days.map((day, i) => (
              <button key={day.id} type="button" onClick={() => jump(`d${i}`)}>
                <b>{navDate(day.date, `Day ${i + dayOffset}`)}</b>{' '}
                <span>{day.label}</span>
              </button>
            ))}
            {legs.length > 0 && (
              <button type="button" onClick={() => jump('travel')}>
                <b>Travel</b>
              </button>
            )}
            {stays.length > 0 && (
              <button type="button" onClick={() => jump('stays')}>
                <b>Hotels</b>
              </button>
            )}
            {stops > 0 && (
              <button type="button" onClick={() => jump('budget')}>
                <b>Budget</b>
              </button>
            )}
          </div>
        </nav>
      )}

      <main>
        {days.length === 0 || stops === 0 ? (
          <section className="day">
            <p className="empty">
              Nothing planned yet. Open the builder, pick a day, and add places to it.
            </p>
            <button type="button" className="edit" onClick={onEdit}>
              Open the builder
            </button>
          </section>
        ) : (
          <>
          {legs.length > 0 && (
            <section className="travel" id="travel">
              <h2>
                Getting there
                <span className="en">
                  Every flight and train on the trip, in the order you take them
                </span>
              </h2>
              <ol className="legs">
                {legs.map(({ day, item, travel }) => (
                  <li key={item.id}>
                    <span className="legmark" aria-hidden>
                      {TRAVEL_MARKS[travel.mode]}
                    </span>
                    <div className="legmain">
                      <b>{legName(travel)}</b>
                      {legRoute(travel) && <span className="legroute">{legRoute(travel)}</span>}
                      <span className="legday">
                        {day.label}
                        {day.date ? ` · ${day.date}` : ''}
                      </span>
                    </div>
                    <div className="legside">
                      <span className="legtime">{legTimes(item)}</span>
                      {(travel.seat || travel.ref) && (
                        <span className="legref">
                          {[travel.seat && `Seat ${travel.seat}`, travel.ref && `Ref ${travel.ref}`]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {stays.length > 0 && (
            <section className="stays" id="stays">
              <h2>
                Where you are staying
                <span className="en">Every hotel on the trip, night by night</span>
              </h2>
              <ol className="hotels">
                {stays.map((block) => (
                  <li key={`${block.from}-${block.stay.name}`}>
                    <span className="staymark" aria-hidden>
                      {'\u{1F6CF}'}
                    </span>
                    <div className="staymain">
                      <b className="zh">{block.stay.name}</b>
                      {block.stay.address && (
                        <span className="stayaddr zh">{block.stay.address}</span>
                      )}
                      {stayDetails(block.stay) && (
                        <span className="stayref">{stayDetails(block.stay)}</span>
                      )}
                    </div>
                    <div className="stayside">
                      <span className="staynights">{nightsLabel(block)}</span>
                      <span className="staycount">
                        {block.nights} {block.nights === 1 ? 'night' : 'nights'}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {days.map((day, i) => {
            const tag = dayTag(day, catalog);
            const cost = sumCosts(day.items);
            return (
              <section className="day" id={`d${i}`} key={day.id}>
                <div className="dayhead">
                  <div className="daynum">{dayNumber(day.date, `DAY ${i + dayOffset}`)}</div>
                  <div className="daytitle">
                    <div className="label">{day.label}</div>
                    <div className="en">
                      {[weekday(day.date), `Day ${i + dayOffset} of ${lastDay}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    {tag && <span className={`tag ${tag.tone}`}>{tag.text}</span>}
                  </div>
                </div>

                {day.items.length === 0 ? (
                  <p className="empty">Nothing planned for this day.</p>
                ) : (
                  <ol className="tl">
                    {day.items.map((item) => {
                      const title = itemTitle(catalog, item.placeId, item.customTitle);
                      const place = item.placeId ? catalog.placeById[item.placeId] : undefined;
                      const when = item.startTime ?? '·';
                      const priced =
                        item.estCostMin !== undefined || item.estCostMax !== undefined;
                      const free = item.estCostMin === 0 && (item.estCostMax ?? 0) === 0;
                      return (
                        <li key={item.id}>
                          <span className="time">{when}</span>
                          <div className="what">
                            <span className="zh">{title.zh}</span>
                            {title.en && <span className="en"> {title.en}</span>}
                          </div>
                          {item.travel && (
                            <div className="leg">
                              <b>
                                <span aria-hidden>{TRAVEL_MARKS[item.travel.mode]}</span>{' '}
                                {legName(item.travel)}
                              </b>
                              <span className="legtime">{legTimes(item)}</span>
                              {legRoute(item.travel) && <span>{legRoute(item.travel)}</span>}
                              {item.travel.seat && <span>Seat {item.travel.seat}</span>}
                              {item.travel.ref && <span>Ref {item.travel.ref}</span>}
                            </div>
                          )}
                          {item.note && <div className="note">{item.note}</div>}
                          {place?.metro && <div className="note">{place.metro}</div>}
                          {place?.addressZh && <div className="note zh">{place.addressZh}</div>}
                          {priced && (
                            <span className={`cost${free ? ' free' : ''}`}>
                              {formatPrice(item.estCostMin, item.estCostMax)}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}

                {day.stay?.name && (
                  <p className="staynight">
                    <span aria-hidden>{'\u{1F6CF}'}</span> Tonight:{' '}
                    <b className="zh">{day.stay.name}</b>
                    {day.stay.address && <span className="zh"> · {day.stay.address}</span>}
                    {stayDetails(day.stay) && <span> · {stayDetails(day.stay)}</span>}
                  </p>
                )}

                {day.items.length > 0 && (
                  <p className="fine">
                    {day.items.length} {day.items.length === 1 ? 'stop' : 'stops'}
                    {cost.known > 0 && ` · ${range(cost)} per person`}
                    {cost.unknown > 0 && ` · ${cost.unknown} without an estimate`}
                  </p>
                )}
              </section>
            );
          })}
          </>
        )}

        {stops > 0 && (
          <section className="budget" id="budget">
            <h2>
              Budget
              <span className="en">Estimated spend per person, excluding flights and hotels</span>
            </h2>
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>What</th>
                  <th className="num">Low</th>
                  <th className="num">High</th>
                </tr>
              </thead>
              <tbody>
                {stays.length > 0 && (
            <section className="stays" id="stays">
              <h2>
                Where you are staying
                <span className="en">Every hotel on the trip, night by night</span>
              </h2>
              <ol className="hotels">
                {stays.map((block) => (
                  <li key={`${block.from}-${block.stay.name}`}>
                    <span className="staymark" aria-hidden>
                      {'\u{1F6CF}'}
                    </span>
                    <div className="staymain">
                      <b className="zh">{block.stay.name}</b>
                      {block.stay.address && (
                        <span className="stayaddr zh">{block.stay.address}</span>
                      )}
                      {stayDetails(block.stay) && (
                        <span className="stayref">{stayDetails(block.stay)}</span>
                      )}
                    </div>
                    <div className="stayside">
                      <span className="staynights">{nightsLabel(block)}</span>
                      <span className="staycount">
                        {block.nights} {block.nights === 1 ? 'night' : 'nights'}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {days.map((day, i) => {
                  const s = sumCosts(day.items);
                  return (
                    <tr key={day.id}>
                      <td>{dayNumber(day.date, `Day ${i + dayOffset}`)}</td>
                      <td>{day.label}</td>
                      <td className="num">{money(s.min)}</td>
                      <td className="num">{money(s.max)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Total, per person</td>
                  <td className="num">{money(grand.min)}</td>
                  <td className="num">{money(grand.max)}</td>
                </tr>
              </tfoot>
            </table>
            {grand.unknown > 0 && (
              <p className="fine">
                {grand.unknown} {grand.unknown === 1 ? 'stop carries' : 'stops carry'} no estimate,
                so the real number sits above this table. Flights and hotels are not counted here.
              </p>
            )}
          </section>
        )}
      </main>

      <footer>
        Safe travels
      </footer>
    </div>
  );
}
