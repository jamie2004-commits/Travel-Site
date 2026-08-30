import type { Place } from '../types';
import { supabase } from './supabase';

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
}

/** A slug the database can key on, derived from the English name. */
function slugify(nameEn: string): string {
  const base = nameEn
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  // A name that is entirely punctuation, or entirely non-latin, leaves nothing
  // behind. Fall back to something unique rather than an empty slug.
  return base || `place-${Date.now().toString(36)}`;
}

/**
 * 23505 is unique_violation. Which constraint tripped decides what to say,
 * since "duplicate key" means nothing to someone adding a restaurant.
 */
function describeFailure(code: string | undefined, message: string): string {
  if (code === '23505') {
    if (message.includes('places_natural_key')) {
      return 'That place is already in the catalog: same name, city and address.';
    }
    if (message.includes('slug')) {
      return 'A place with that name already exists. Try a more specific name.';
    }
    return 'That place is already in the catalog.';
  }
  if (code === '23503') {
    return 'That district does not exist in the catalog yet.';
  }
  if (code === '42501' || code === 'PGRST301') {
    return 'You need to be signed in to add a place.';
  }
  return message;
}

export async function insertPlace(place: Place): Promise<WriteResult> {
  if (!supabase) {
    return { ok: false, message: 'Supabase is not configured for this build.' };
  }

  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) {
    return { ok: false, message: 'Sign in first to add a place to the database.' };
  }

  const { error } = await supabase.from('places').insert({
    slug: slugify(place.nameEn),
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
    duration_minutes: place.durationMinutes ?? null,
    source: 'user',
    created_by: userId,
  });

  if (error) {
    return { ok: false, message: describeFailure(error.code, error.message) };
  }
  return { ok: true, message: `Added ${place.nameEn || place.nameZh}` };
}
