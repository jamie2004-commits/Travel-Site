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

/** Display title for an itinerary item, Chinese first. */
export function itemTitle(catalog: Catalog, placeId?: string, customTitle?: string) {
  const place = placeId ? catalog.placeById[placeId] : undefined;
  if (place) return { zh: place.nameZh, en: place.nameEn === place.nameZh ? '' : place.nameEn };
  return { zh: customTitle ?? '', en: '' };
}
