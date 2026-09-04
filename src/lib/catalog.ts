import type { District, Place } from '../types';

/** Where the browsable library came from, for the status line in the UI. */
export type CatalogOrigin = 'supabase' | 'bundled';

export interface Catalog {
  places: Place[];
  districts: District[];
  placeById: Record<string, Place>;
  districtById: Record<string, District>;
  origin: CatalogOrigin;
}

export function buildCatalog(
  places: Place[],
  districts: District[],
  origin: CatalogOrigin,
): Catalog {
  return {
    places,
    districts,
    origin,
    placeById: Object.fromEntries(places.map((p) => [p.id, p])),
    districtById: Object.fromEntries(districts.map((d) => [d.id, d])),
  };
}

export const emptyCatalog = buildCatalog([], [], 'bundled');

/**
 * A readable name back out of a slug, for a place the catalog has lost. Slugs
 * are generated from the English name, so reading one back is usually enough to
 * recognise the stop: "west-lake-and-bai-causeway" to "West Lake And Bai
 * Causeway". Imperfect on the small words, and far better than a blank line.
 */
function nameFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export interface ItemTitle {
  /** The name to lead with. Chinese where there is one. */
  zh: string;
  /** The English name, and only ever that. Empty when there is not one. */
  en: string;
  /**
   * Why this stop has nothing behind it. Set only when the place has left the
   * catalog, and never a name: callers that want the name read zh or en, and
   * putting a status phrase in either of those makes them say the wrong thing.
   */
  note?: string;
}

/**
 * Display title for an itinerary item, Chinese first.
 *
 * The last branch is for a stop whose place is not in the catalog any more.
 * That is not hypothetical: 0004 and 0005 delete rows, and a trip saved before
 * one of those migrations still points at the slugs they removed. It used to
 * return an empty string, so the stop rendered as a time with nothing beside
 * it, which reads as a bug in the sheet rather than as a place that went away.
 */
export function itemTitle(catalog: Catalog, placeId?: string, customTitle?: string): ItemTitle {
  const place = placeId ? catalog.placeById[placeId] : undefined;
  if (place) return { zh: place.nameZh, en: place.nameEn === place.nameZh ? '' : place.nameEn };
  if (customTitle) return { zh: customTitle, en: '' };
  if (placeId) {
    // A place added in this browser carries an opaque id rather than a name,
    // so there is nothing to read back out of it.
    if (placeId.startsWith('user:')) {
      return { zh: 'Added place', en: '', note: 'no longer in the library' };
    }
    return { zh: nameFromSlug(placeId), en: '', note: 'no longer in the library' };
  }
  return { zh: '', en: '' };
}
