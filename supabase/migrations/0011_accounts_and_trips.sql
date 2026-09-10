-- Many trips per person, chosen per device.
--
-- Run after 0010_checklist.sql. Idempotent: safe to run more than once.
--
-- Run this BEFORE deploying the build that goes with it, and run
-- 0012_retire_trip_codes.sql only AFTER. The order matters and the reason is
-- at the top of 0012.
--
-- ----------------------------------------------------------- what this is
--
-- 0006 gave every person exactly one trip, through a partial unique index on
-- (owner_id) where is_active. The app read `where is_active` and got one row,
-- with nothing to sort and no tie to break, and two devices racing for the
-- slot could not both win. That was the right shape while a person was a
-- browser.
--
-- It stops being the right shape the moment a person is an account. Two things
-- break at once:
--
--   A second trip cannot exist. "Save this trip and start another" is an
--   insert that violates the index. The comment in 0006 anticipated the
--   opposite -- "many rows per owner are allowed from day one, so a second trip
--   is an insert rather than a migration" -- and that is true of the table and
--   false of this index, which is the only thing standing in the way.
--
--   One active slot per *account* means the laptop and the phone must have the
--   same trip open. Switching trips on one would switch it under the other,
--   mid-edit, with the sync layer pushing into whichever row won. The slot was
--   per browser when a browser was a person. Shared, it is a race.
--
-- So the slot goes, and the client names the row it wants instead. Which trip
-- a device has open becomes that device's business, held in its own storage,
-- and the server stops having an opinion. `is_active` stays as what it always
-- meant underneath: this is a real trip, not an archived copy.

-- ------------------------------------------------------------- the slot goes

drop index if exists public.itineraries_one_active_per_owner;

-- What replaces it is not a constraint but an ordering. The trip list asks for
-- one account's live trips, newest first, and without this that is a sort over
-- everything the account owns including every backup it has ever imported.
create index if not exists itineraries_live_by_owner
  on public.itineraries (owner_id, updated_at desc)
  where is_active and source = 'app';

comment on column public.itineraries.is_active is
  'A real trip rather than an archived copy. No longer a slot: an account may have many.';

-- ------------------------------------------------------- losing the fork guard
--
-- The index was doing a second job worth naming, because nothing inherits it.
--
-- It was the guard against forking: two devices holding local data and both
-- claiming the slot could not both succeed, so the loser's insert failed with
-- 23505 and the client kept that copy archived rather than throwing it away.
-- With the slot gone, two such inserts both succeed and the account quietly has
-- two trips that are each half the story.
--
-- What replaces it is that a device no longer guesses. It opens the trip whose
-- id it holds, and a device holding no id is asked which trip it wants rather
-- than inserting one on a hunch. The guard moves from the database to the point
-- where the ambiguity actually is, which is a device with data and no answer to
-- "which trip is this?". A unique index cannot ask that question; a dialog can.

-- ================================================================== checks

select * from (
  select 1 as ord, 'the one-active slot is gone' as check, '' as found,
    case when exists (select 1 from pg_indexes
                      where schemaname = 'public'
                        and indexname = 'itineraries_one_active_per_owner')
         then 'still there, a second trip cannot be inserted' else 'ok' end as status

  union all
  select 2, 'the listing index is there', '',
    case when exists (select 1 from pg_indexes
                      where schemaname = 'public' and indexname = 'itineraries_live_by_owner')
         then 'ok' else 'missing, the trip list sorts the hard way' end

  union all
  select 3, 'trips stored', (select count(*)::text from public.itineraries), 'ok'

  union all
  select 4, 'live app trips', 
    (select count(*)::text from public.itineraries where is_active and source = 'app'), 'ok'

  union all
  select 5, 'accounts holding more than one live trip',
    (select count(*)::text from (
       select owner_id from public.itineraries
       where is_active and source = 'app'
       group by owner_id having count(*) > 1) x),
    'ok, this is now allowed and was not before'
) t order by ord;
