import { places } from '../data/places';
import { districts } from '../data/districts';
import type { District, Place } from '../types';

export const placeById: Record<string, Place> = Object.fromEntries(
  places.map((p) => [p.id, p]),
);

export const districtById: Record<string, District> = Object.fromEntries(
  districts.map((d) => [d.id, d]),
);

/** Display title for an itinerary item, Chinese first. */
export function itemTitle(placeId?: string, customTitle?: string) {
  const place = placeId ? placeById[placeId] : undefined;
  if (place) return { zh: place.nameZh, en: place.nameEn === place.nameZh ? '' : place.nameEn };
  return { zh: customTitle ?? '', en: '' };
}
