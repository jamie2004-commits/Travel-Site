import type { City, Category, District, Place } from '../types';
import { places as bundledPlaces } from '../data/places';
import { districts as bundledDistricts } from '../data/districts';
import { supabase } from './supabase';
import { buildCatalog, type Catalog } from './catalog';

interface PlaceRow {
  slug: string;
  name_zh: string;
  name_en: string;
  city: City;
  district_id: string;
  category: Category;
  description: string | null;
  tags: string[] | null;
  price_min: number | null;
  price_max: number | null;
  address_zh: string | null;
  metro: string | null;
  duration_minutes: number | null;
}

interface DistrictRow {
  id: string;
  city: City;
  name_zh: string;
  name_en: string;
  accent_color: string;
}

const orUndefined = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

/**
 * The slug is the app's place id, not the uuid. Itineraries saved before
 * Supabase existed reference the slug, and the bundled catalog is keyed the
 * same way, so the two sources stay interchangeable.
 */
const toPlace = (row: PlaceRow): Place => ({
  id: row.slug,
  nameZh: row.name_zh,
  nameEn: row.name_en,
  city: row.city,
  district: row.district_id,
  category: row.category,
  description: row.description ?? '',
  tags: row.tags ?? [],
  priceMin: orUndefined(row.price_min),
  priceMax: orUndefined(row.price_max),
  addressZh: orUndefined(row.address_zh),
  metro: orUndefined(row.metro),
  durationMinutes: orUndefined(row.duration_minutes),
});

const toDistrict = (row: DistrictRow): District => ({
  id: row.id,
  city: row.city,
  nameZh: row.name_zh,
  nameEn: row.name_en,
  accentColor: row.accent_color,
});

export const bundledCatalog = buildCatalog(bundledPlaces, bundledDistricts, 'bundled');

/**
 * A bad hostname leaves fetch retrying for the best part of a minute before it
 * gives up. The bundled catalog is already on screen by then, so there is
 * nothing to gain by waiting: cut it short and say so.
 */
const LOAD_TIMEOUT_MS = 6000;

export interface CatalogLoad {
  catalog: Catalog;
  /** Set when Supabase was configured but could not be read. */
  error?: string;
}

/**
 * The catalog is about a hundred rows, so it is fetched once and filtered in
 * the browser. That keeps search instant, keeps the filter code identical to
 * the bundled path, and means the library still works once loaded if the
 * connection drops.
 */
export async function loadCatalog(): Promise<CatalogLoad> {
  if (!supabase) return { catalog: bundledCatalog };

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = Symbol('timeout');

  try {
    const queries = Promise.all([
      supabase
        .from('districts')
        .select('id, city, name_zh, name_en, accent_color')
        .abortSignal(controller.signal),
      supabase
        .from('places')
        .select(
          'slug, name_zh, name_en, city, district_id, category, description, tags, price_min, price_max, address_zh, metro, duration_minutes',
        )
        .abortSignal(controller.signal),
    ]);

    // Raced, not awaited with an abort alongside: aborting asks the request to
    // stop but does not make it settle, and a dead hostname can sit unresolved
    // far longer than the budget. The race is what bounds the wait.
    const settled = await Promise.race([
      queries,
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), LOAD_TIMEOUT_MS);
      }),
    ]);

    if (settled === timedOut) {
      controller.abort();
      return {
        catalog: bundledCatalog,
        error: `no answer within ${LOAD_TIMEOUT_MS / 1000} seconds`,
      };
    }

    const [districtsResult, placesResult] = settled;
    const failure = districtsResult.error ?? placesResult.error;
    if (failure) return { catalog: bundledCatalog, error: failure.message };

    const districts = (districtsResult.data ?? []) as DistrictRow[];
    const places = (placesResult.data ?? []) as PlaceRow[];
    if (!places.length) {
      return { catalog: bundledCatalog, error: 'The places table is empty. Run supabase/seed.sql.' };
    }

    return {
      catalog: buildCatalog(places.map(toPlace), districts.map(toDistrict), 'supabase'),
    };
  } catch (cause) {
    if (controller.signal.aborted) {
      return {
        catalog: bundledCatalog,
        error: `no answer within ${LOAD_TIMEOUT_MS / 1000} seconds`,
      };
    }
    return {
      catalog: bundledCatalog,
      error: cause instanceof Error ? cause.message : 'could not be reached',
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
