import type { Place } from '../types';
import { supabase } from './supabase';
import { ensureIdentity } from './identity';

/**
 * Writing a place to the catalog. Reads live in catalogSource; writes are
 * here so the read path stays free of anything that needs a session.
 *
 * Row level security is what actually decides these calls: insert, update and
 * delete are granted to `authenticated` only, and each row is owned by the
 * user who created it. A signed out visitor gets a refusal from Postgres, not
 * from a check in this file.
 */

export interface WriteResult {
  ok: boolean;
  /** Ready to show. Postgres messages are translated where they are cryptic. */
  message: string;
  /**
   * The request never reached the database. Distinct from a refusal: a refusal
   * is the person's to fix and has to be shown, while this is worth falling
   * back to local storage over. A flag rather than a string match on the
   * message, which would break the day somebody rewrote the copy.
   */
  unreachable?: boolean;
}

/**
 * A slug for a place added in the app. Two rules, both deliberate.
 *
 * The `u-` prefix keeps user rows out of the namespace seed.sql writes into, so
 * a re-seed can never land on top of one. Migration 0007 makes that a policy
 * condition rather than a convention.
 *
 * The random tail makes it unique without a round trip, which means a slug
 * collision stops being something the user has to understand. Duplicates are
 * caught by the natural key, which knows what "the same place" actually means.
 * Before this, adding "West Lake" in Shanghai when Hangzhou already had one
 * collided on the slug and the user was told to "try a more specific name",
 * which was wrong advice about the wrong problem.
 *
 * The base uses the same ascii rule as scripts/extract.mjs, so there is one
 * answer in this repo to what a slug looks like.
 */
function userSlug(nameEn: string): string {
  const base = nameEn
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const tail =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 6)
      : Math.random().toString(36).slice(2, 8);
  return base ? `u-${base}-${tail}` : `u-${tail}`;
}

/**
 * 23505 is unique_violation. Which constraint tripped decides what to say,
 * since "duplicate key" means nothing to someone adding a restaurant.
 */
function describeFailure(code: string | undefined, message: string): string {
  // An empty code means the request never reached Postgres at all.
  if (!code) return 'Could not reach the database. Nothing was changed.';

  if (code === '23505') {
    if (message.includes('places_natural_key')) {
      return 'That place is already in the catalog: same name, city and address.';
    }
    if (message.includes('slug')) {
      return 'That place is already in the catalog.';
    }
    return 'That place is already in the catalog.';
  }

  // Check violations. These were reaching the user as raw Postgres text, which
  // names a constraint rather than the field somebody typed in.
  if (code === '23514') {
    if (message.includes('duration_minutes')) {
      return 'How long it takes has to be more than zero minutes. Leave it blank if you do not know.';
    }
    if (message.includes('places_price_order')) {
      return 'The high price has to be at least the low price.';
    }
    if (message.includes('price_min') || message.includes('price_max')) {
      return 'A price cannot be less than zero.';
    }
    if (message.includes('places_name_en_not_blank')) return 'A place needs a name.';
    if (message.includes('places_city_not_blank')) return 'A place needs a city.';
    if (message.includes('places_country_format')) {
      return 'The country has to be a two letter code, like CN or JP.';
    }
    return 'One of the fields is out of range. Check the prices and the minutes.';
  }

  if (code === '23502') {
    return 'That place is missing something it needs. Check the name, the city and the district.';
  }
  if (code === '22P02') return 'One of the numbers is not a number.';
  if (code === '23503') {
    return 'That district is not in the database yet. The list on screen is the built-in one, which is ahead of the database.';
  }
  if (code === '42501') {
    // With anonymous sign ins every visitor has an identity, so this is no
    // longer "you are signed out". It is the row cap, or someone else's row.
    return 'That change was refused. You may have reached the limit on places you can add.';
  }
  if (code === 'PGRST301') {
    return 'This browser lost its place with the database. Reload and try again.';
  }
  if (code === '57014') return 'The database took too long to answer. Try again.';
  return message;
}

/**
 * Remove a place from the catalog by its slug, which is the app's place id.
 *
 * Row level security does not raise when a row is not yours: the policy's using
 * clause filters it out and the delete affects nothing. So zero rows back means
 * either "already gone" or "not yours", and those need different words. One
 * follow-up read tells them apart. This is the single easiest thing here to get
 * wrong, because the happy path and the refused path look identical.
 */
export async function deletePlace(slug: string): Promise<WriteResult> {
  if (!supabase) {
    return { ok: false, message: 'Supabase is not configured for this build.' };
  }

  const { data, error } = await supabase.from('places').delete().eq('slug', slug).select('slug');

  if (error) {
    return { ok: false, message: describeFailure(error.code, error.message) };
  }
  if (data && data.length > 0) {
    return { ok: true, message: 'Deleted' };
  }

  const { data: still } = await supabase
    .from('places')
    .select('slug, created_by')
    .eq('slug', slug)
    .maybeSingle();

  if (!still) {
    // Gone is the state the user wanted, so this is not a failure.
    return { ok: true, message: 'That place had already been removed.' };
  }
  return {
    ok: false,
    message:
      still.created_by === null
        ? 'That place is part of the built-in catalog, so it cannot be deleted.'
        : 'That place was added by someone else, so only they can delete it.',
  };
}

/**
 * Change a place in place.
 *
 * The slug is never sent and never changes, whatever the name becomes, because
 * it is what saved itineraries point at. That one decision is what makes edit
 * cheap: no itinerary reference can break, so there is no detach path, and the
 * only reachable duplicate error is the natural key.
 */
export async function updatePlace(place: Place): Promise<WriteResult> {
  if (!supabase) {
    return { ok: false, message: 'Supabase is not configured for this build.' };
  }

  const { data, error } = await supabase
    .from('places')
    .update({
      name_zh: place.nameZh?.trim() || null,
      name_en: place.nameEn.trim(),
      city: place.city,
      district_id: place.district,
      category: place.category,
      description: place.description ?? '',
      tags: (place.tags ?? []).join(', '),
      price_min: place.priceMin ?? null,
      price_max: place.priceMax ?? null,
      address: place.addressZh?.trim() || null,
      metro: place.metro?.trim() || null,
      // `|| null` and not `?? null`: zero is a value the dialog can produce and
      // the column demands greater than zero.
      duration_minutes: place.durationMinutes || null,
    })
    .eq('slug', place.id)
    .select('slug');

  if (error) {
    return { ok: false, message: describeFailure(error.code, error.message) };
  }
  if (data && data.length > 0) return { ok: true, message: 'Saved' };

  return {
    ok: false,
    message: 'That place was added by someone else, so only they can change it.',
  };
}

export async function insertPlace(place: Place): Promise<WriteResult> {
  if (!supabase) {
    return { ok: false, message: 'Supabase is not configured for this build.' };
  }

  // Every browser holds an anonymous identity, taken on first load. That is
  // what auth.uid() reads, and therefore what the insert policy checks. There
  // is no signed-out state to refuse any more; there is only a browser that
  // could not reach the server to take one.
  const identity = await ensureIdentity();
  if (identity.kind !== 'cloud') {
    return { ok: false, unreachable: true, message: 'Could not reach the database.' };
  }
  const userId = identity.userId;

  const { error } = await supabase.from('places').insert({
    slug: userSlug(place.nameEn),
    name_zh: place.nameZh?.trim() || null,
    name_en: place.nameEn.trim(),
    city: place.city,
    country: 'CN',
    district_id: place.district,
    category: place.category,
    description: place.description ?? '',
    // The column is a comma separated string; Postgres generates the array.
    tags: (place.tags ?? []).join(', '),
    price_min: place.priceMin ?? null,
    price_max: place.priceMax ?? null,
    address: place.addressZh?.trim() || null,
    metro: place.metro?.trim() || null,
    duration_minutes: place.durationMinutes || null,
    source: 'user',
    created_by: userId,
  });

  if (error) {
    return {
      ok: false,
      unreachable: !error.code,
      message: describeFailure(error.code, error.message),
    };
  }
  return { ok: true, message: `Added ${place.nameEn || place.nameZh}` };
}
