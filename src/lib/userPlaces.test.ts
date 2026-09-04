import { describe, it, expect } from 'vitest';
import { canEditPlace, isAddedPlace, isLocalPlace } from './userPlaces';
import type { Place } from '../types';

/**
 * The predicate that decides whether a delete control is drawn.
 *
 * It has to be exactly the test the RLS policy applies, or the button lies in
 * one direction or the other: offered and then refused, or withheld from
 * someone who is allowed. The policy is
 * `using (created_by = auth.uid())` in 0001, unchanged by 0007.
 */

const base: Place = {
  id: 'west-lake',
  nameZh: '西湖',
  nameEn: 'West Lake',
  city: 'hangzhou',
  district: 'xihu',
  category: 'sight',
  description: '',
  tags: [],
};

const ME = 'aaaaaaaa-0000-0000-0000-000000000000';
const SOMEONE = 'bbbbbbbb-0000-0000-0000-000000000000';

describe('canEditPlace', () => {
  it('refuses a seeded place, whoever is asking', () => {
    // seed.sql never sets created_by, so this is every one of the 136. In
    // Postgres `null = uid` is null, not true, so no policy can ever match.
    const seeded = { ...base, source: 'itinerary.html', createdBy: null };
    expect(canEditPlace(seeded, ME)).toBe(false);
    expect(canEditPlace(seeded, null)).toBe(false);
  });

  it('allows a place this person added', () => {
    expect(canEditPlace({ ...base, source: 'user', createdBy: ME }, ME)).toBe(true);
  });

  it('refuses a place somebody else added', () => {
    expect(canEditPlace({ ...base, source: 'user', createdBy: SOMEONE }, ME)).toBe(false);
  });

  it('refuses everything while the identity is still resolving', () => {
    expect(canEditPlace({ ...base, source: 'user', createdBy: ME }, null)).toBe(false);
  });

  it('allows a place kept only in this browser, which no policy governs', () => {
    expect(canEditPlace({ ...base, id: 'user:abc' }, null)).toBe(true);
  });

  it('refuses a place from the bundled catalog, which carries no owner', () => {
    // The fallback when Supabase is unreachable. Those are seeded places.
    expect(canEditPlace(base, ME)).toBe(false);
  });

  it('keys on createdBy and not on source, because a re-seed moves source', () => {
    // seed.sql rewrites source on a colliding slug and leaves created_by alone.
    // Keying on source would quietly withdraw a delete the database allows.
    const reseeded = { ...base, source: 'itinerary.html', createdBy: ME };
    expect(canEditPlace(reseeded, ME)).toBe(true);
  });
});

describe('isLocalPlace and isAddedPlace', () => {
  it('tells a browser-only place from a stored one', () => {
    expect(isLocalPlace({ ...base, id: 'user:abc' })).toBe(true);
    expect(isLocalPlace(base)).toBe(false);
  });

  it('counts both kinds as added, for the card label', () => {
    expect(isAddedPlace({ ...base, id: 'user:abc' })).toBe(true);
    expect(isAddedPlace({ ...base, source: 'user' })).toBe(true);
    expect(isAddedPlace({ ...base, source: 'itinerary.html' })).toBe(false);
    expect(isAddedPlace(base)).toBe(false);
  });
});
