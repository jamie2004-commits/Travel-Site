-- Let anyone add a place, and correct what 0001 says about that.
--
-- Run after 0006_itinerary.sql. Idempotent: safe to run more than once.
--
-- Re-run this after ever re-running 0001 or 0003. Both silently undo parts of
-- it: 0001 recreates the insert and update policies without the cap or the
-- source pin, and 0003 drops and recreates the two views, which loses the
-- security_invoker setting because a recreated view carries no reloptions.
-- Nothing warns; the checks at the foot of this file are how you would find out.
--
-- Nothing in this file changes what an anonymous visitor CAN do. Enabling
-- Supabase anonymous sign ins already does that, because an anonymous user
-- assumes the `authenticated` role, and 0001 grants insert, update and delete
-- on places to `authenticated`. That is worth stating plainly, because 0001
-- says the opposite in a comment and the comment is now wrong:
--
--   "Writing is closed to anonymous visitors."   0001_catalog.sql, line 81
--
-- It was true when it was written. Flipping the anonymous sign ins toggle makes
-- it false with no migration and no code change, which is exactly the sort of
-- thing nobody notices. So this file exists to make the decision explicit, put
-- bounds on it, and fix a leak that the decision would otherwise open.
--
-- The decision: the catalog is open. Anyone who can reach the site can add a
-- place, and everyone sees what anyone adds. That is what makes an "add a
-- place" button worth having on a trip several people are planning together.
-- The seeded 136 places are not at risk either way: they carry
-- created_by = null, so no update or delete policy can ever match them.

-- ------------------------------------------------------------- the row cap
--
-- The one bound worth having. Without it a single visitor can insert without
-- limit, and the catalog is shared, so that is everyone's problem rather than
-- theirs. Two hundred is far above what a person planning a trip will add and
-- far below what makes the library unusable.
--
-- Written as a subquery inside the policy because a check constraint may not
-- contain a select. It costs one indexed count per insert, which is why the
-- index below exists: 0001 indexes city, category and district, not created_by.

create index if not exists places_created_by_idx on public.places (created_by);

drop policy if exists "signed in users can add places" on public.places;
create policy "signed in users can add places"
  on public.places for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    -- Pinned, not merely defaulted. Without this a visitor can write
    -- source = 'itinerary.html' and their row then looks seeded, which is the
    -- flag 0004 and 0005 read before deleting anything.
    and source = 'user'
    and (select count(*) from public.places p where p.created_by = (select auth.uid())) < 200
  );

-- The same reasoning on update: a with check sees only the new row, so without
-- pinning source here a user could edit their own row into a seeded-looking one.
drop policy if exists "authors can edit their own places" on public.places;
create policy "authors can edit their own places"
  on public.places for update
  to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()) and source = 'user');

drop policy if exists "authors can remove their own places" on public.places;
create policy "authors can remove their own places"
  on public.places for delete
  to authenticated
  using (created_by = (select auth.uid()));

-- ------------------------------------------------------ the views leak RLS
--
-- place_with_review and place_area_stats are plain views owned by postgres, and
-- Postgres runs a view's query as its owner unless security_invoker is set.
-- Nothing in supabase/ set it. 0002 says views "inherit the policies of the
-- tables underneath", which is true in effect there only because places and
-- place_reviews are world readable, and is not true in general.
--
-- Harmless while everything in the catalog is public, which is the decision
-- above. It stops being harmless the moment anything private is joined to
-- these, and the itinerary tables from 0006 are exactly that. Two statements,
-- no app code reads either view, so this is free now and expensive later.

alter view public.place_with_review set (security_invoker = on);
alter view public.place_area_stats  set (security_invoker = on);

-- ------------------------------------------------- abandoned anonymous rows
--
-- created_by was `on delete set null`. Anonymous users accumulate, one per
-- browser that ever loads the page, and Supabase has no automatic cleanup. With
-- set null, deleting an abandoned account turns its places into rows with
-- source = 'user' and created_by = null: editable and deletable by nobody, and
-- indistinguishable from a seeded row to 0004 and 0005. Cascade instead, so
-- removing an account removes what it added.

-- One transaction, explicitly, and not because the SQL editor happens to give
-- one. Any path that runs these as separate statements, psql -c or a paste
-- split across two tabs, can commit the drop and fail the add, leaving
-- created_by with no foreign key at all. Nothing would report that: the checks
-- at the foot of this file do not look at pg_constraint, so they would print
-- ok over exactly that state.
--
-- Before running, confirm the constraint is named what this expects:
--
--   select conname, confdeltype from pg_constraint
--   where conrelid = 'public.places'::regclass and contype = 'f';
--
-- One row, `places_created_by_fkey | n`. If the name differs, edit it below
-- first: `drop constraint if exists` would silently drop nothing and the add
-- would then leave TWO foreign keys on the column, one set null and one
-- cascade, both firing on a user deletion.
begin;

alter table public.places drop constraint if exists places_created_by_fkey;
alter table public.places add constraint places_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete cascade;

commit;

-- What this cascade reaches, stated because it is further than it looks.
-- place_reviews.place_id is already `on delete cascade` (0002), so the chain
-- is now: delete an auth.users row -> delete that user's places -> delete
-- EVERY review on those places, written by anyone.
--
-- That matters because anonymous sign ins mint an auth.users row on every
-- first page load, so throwaway accounts accumulate and Supabase does not
-- clean them up. The obvious housekeeping, bulk deleting old anonymous users,
-- would take other people's reviews with it. Under the old set null it could
-- not. Prune by looking at what an account actually added, not by age alone.

-- ================================================================== checks

select * from (
  select 1 as ord, 'anon can read places' as check, '' as found,
    case when exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'places' and cmd = 'SELECT')
         then 'ok' else 'missing, the site would show nothing' end as status

  union all
  select 2, 'a visitor can add a place', '',
    case when exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'places' and cmd = 'INSERT'
                        and 'authenticated' = any (roles))
         then 'ok, this is the open catalog decision'
         else 'missing, the add button would fail' end

  union all
  select 3, 'added places are capped per person', '',
    case when exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'places' and cmd = 'INSERT'
                        and with_check like '%200%')
         then 'ok' else 'missing, one visitor could fill the catalog' end

  union all
  select 4, 'source is pinned on insert and update', '',
    case when (select count(*) from pg_policies
               where schemaname = 'public' and tablename = 'places'
                 and cmd in ('INSERT', 'UPDATE')
                 and with_check like '%source%') = 2
         then 'ok' else 'a visitor could make their row look seeded' end

  union all
  select 5, 'the rollup views run as the caller', '',
    case when (select count(*) from pg_class c
               join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public'
                 and c.relname in ('place_with_review', 'place_area_stats')
                 and (c.reloptions @> array['security_invoker=on']
                   or c.reloptions @> array['security_invoker=true'])) = 2
         then 'ok' else 'these bypass row level security, re-run the alter view lines' end

  union all
  select 6, 'seeded places belong to nobody', (select count(*)::text from public.places where created_by is null),
    case when (select count(*) from public.places where created_by is null) >= 136
         then 'ok, nobody can edit or delete these'
         else 'fewer than expected, check the seed' end

  union all
  select 7, 'places added in the app', (select count(*)::text from public.places where source = 'user'), 'ok'
) t order by ord;
