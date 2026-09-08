-- Let a visitor delete a seeded place from the catalog.
--
-- Run after 0008_trip_codes.sql. Idempotent: safe to run more than once.
--
-- Re-run this after ever re-running 0001 or 0007. Both drop and recreate the
-- delete policy on places, and neither knows about this file, so either one
-- silently puts the seeded catalog back out of reach. Nothing warns; the
-- checks at the foot of this file are how you would find out.
--
-- ----------------------------------------------------------- what this is
--
-- 0001 and 0007 both say the same thing, twice, on purpose: the seeded 136
-- places carry created_by = null, no update or delete policy can ever match
-- null against auth.uid(), and that is what protects them. This file removes
-- that protection deliberately, because it also made "delete an activity I do
-- not want" impossible for every place the app did not add itself. On the
-- Shanghai things-to-do tab that is all 27 of them.
--
-- ------------------------------------------------------------ what it costs
--
-- Read this before running it. Anonymous sign ins are on, so `authenticated`
-- means anybody who opens the deployed URL. After this migration any one of
-- them can delete any seeded place, for everyone, from the browser console or
-- a script holding the anon key out of the bundle. There is no per-row owner
-- to appeal to, because seeded rows have no owner. That is the whole point of
-- the change and it is also its entire risk.
--
-- Three things bound it, and they are worth knowing before you decide:
--
--   The seed is the undo. seed.sql upserts on slug, so re-running it restores
--   every seeded row this deletes. The rows come back with new uuids, which
--   matters only to place_reviews, below. A trip pointing at a deleted place
--   keeps working either way: the app detaches the stop to a plain entry under
--   the name it had, and re-seeding does not re-link it.
--
--   Reviews do not come back. place_reviews.place_id is `on delete cascade`
--   (0002), so deleting a place deletes every review anyone wrote on it, and
--   re-seeding gives the place a new uuid that the old reviews no longer point
--   at. 0004 refused to delete a reviewed row for exactly this reason. A policy
--   cannot make that judgement per row without making a refusal look like
--   "already gone" to the caller, so the guard lives in the app instead: read
--   the review count before offering the button if that ever matters here.
--
--   Places somebody ADDED are untouched by this. The policy below matches only
--   seeded rows; 0007's "authors can remove their own places" still decides
--   user rows, and still lets only their author delete them.
--
-- If this turns out to be too open, the narrower version is to drop this policy
-- and move the delete behind a security definer function that takes the trip
-- code, the way 0008 does for the itinerary. That is more code and it is the
-- right answer the day this site has strangers on it.

-- source is read as well as created_by, and not for redundancy. 0007's own
-- header warns that re-running 0001 restores `on delete set null` on
-- created_by, which leaves an abandoned user row with created_by = null and
-- makes it indistinguishable from a seeded one. Requiring source <> 'user' is
-- what stops this policy quietly becoming "anyone may delete anyone's place".
-- It is the same pair of conditions 0004 and 0005 guard their deletes with.
drop policy if exists "anyone can remove a seeded place" on public.places;
create policy "anyone can remove a seeded place"
  on public.places for delete
  to authenticated
  using (created_by is null and source <> 'user');

comment on table public.places is
  'The browsable catalog. Seeded rows are deletable by any visitor (0009); rows added in the app are deletable only by their author (0007).';

-- ================================================================== checks

select * from (
  select 1 as ord, 'seeded places can be deleted' as check, '' as found,
    case when exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'places' and cmd = 'DELETE'
                        and policyname = 'anyone can remove a seeded place')
         then 'ok, this is the decision in this file'
         else 'missing, re-run this file after 0001 or 0007' end as status

  union all
  select 2, 'the seeded delete cannot reach a user row', '',
    case when exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'places' and cmd = 'DELETE'
                        and policyname = 'anyone can remove a seeded place'
                        and qual like '%source%')
         then 'ok'
         else 'the source guard is gone, an abandoned user row is now deletable by anyone' end

  union all
  select 3, 'authors still own what they added', '',
    case when exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'places' and cmd = 'DELETE'
                        and policyname = 'authors can remove their own places')
         then 'ok' else 'missing, re-run 0007' end

  union all
  select 4, 'seeded places left', (select count(*)::text from public.places where created_by is null),
    case when (select count(*) from public.places where created_by is null) >= 136
         then 'ok, none deleted yet'
         else 'fewer than the seed writes, which is this feature working' end

  union all
  select 5, 'reviews that a delete would take with them',
    (select count(*)::text from public.place_reviews r
      join public.places p on p.id = r.place_id
     where p.created_by is null),
    'these are lost if their place is deleted, and do not come back with a re-seed'
) t order by ord;
