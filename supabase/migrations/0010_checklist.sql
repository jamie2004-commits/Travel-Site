-- The packing list and the run up to leaving, kept beside the trip.
--
-- Run after 0009_delete_catalog_places.sql. Idempotent: safe to run more than
-- once. Nothing else depends on it, and the app works without it: the lists
-- live in IndexedDB and that is what renders, so an unmigrated project simply
-- keeps them in one browser.
--
-- Shaped on public.expenses from 0006 rather than on anything new, because it
-- is the same kind of fact: a list of small rows that belongs to a trip, is
-- edited from more than one device, and must survive the plan it was written
-- against. The two functions at the foot are the same pair 0008 wrote for the
-- ledger, for the same reason: a trip opened by its code belongs to another
-- browser, so its rows are out of reach of an owner-scoped policy.
--
-- Why rows and not a field on the trip document. The document has a one
-- megabyte ceiling and every save ships all of it, so a tick would upload the
-- whole plan. And ticking is the single most likely thing for two people to do
-- at the same instant, on two phones, which is exactly where a compare and swap
-- on one document throws one of them away.

create table if not exists public.trip_checklist (
  id            uuid primary key default gen_random_uuid(),

  owner_id      uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,

  -- Weak on purpose, the way expenses.itinerary_id is. A packing list outlives
  -- the plan it was written for: the trip gets deleted and rewritten, and
  -- "passport" is still true.
  itinerary_id  uuid references public.itineraries (id) on delete set null,

  -- The id this row had in the browser, "chk-...". Lets a sync upsert instead
  -- of duplicating, and lets it run twice.
  local_id      text,

  -- 'packing' or 'prep'. Deliberately not a check constraint: 0003 removed
  -- `city in ('shanghai','hangzhou')` for exactly this reason, and a third list
  -- should not need a migration.
  kind          text not null default 'packing',

  -- The item itself. Named label to match expenses rather than `text`, which
  -- reads as the type it is not.
  label         text not null default '',

  done          boolean not null default false,

  -- The free text grouping. Named heading and not `group`, which is reserved
  -- and would need quoting at every use. Null is the unfiled bucket, which the
  -- client draws last.
  heading       text,

  -- What orders a list within its heading. A real instant, unlike the camera
  -- clock 0009 had to keep as text: this is written by the browser with
  -- toISOString(), so there is a timezone on it and timestamptz is honest.
  added_at      timestamptz not null default now(),

  client_id     text,
  source        text not null default 'app',
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint trip_checklist_kind_not_blank check (length(trim(kind)) > 0),
  constraint trip_checklist_label_length   check (length(label) <= 200),
  constraint trip_checklist_heading_length check (heading is null or length(heading) <= 60),

  constraint trip_checklist_one_row_per_local_id unique (owner_id, local_id)
);

create index if not exists trip_checklist_owner_idx
  on public.trip_checklist (owner_id, added_at);

create index if not exists trip_checklist_itinerary_idx
  on public.trip_checklist (itinerary_id);

comment on table public.trip_checklist is
  'What to pack and what to do before leaving. Beside the itinerary, never inside it.';

-- The same touch trigger the other tables use, so updated_at means something.
drop trigger if exists trip_checklist_touch on public.trip_checklist;
create trigger trip_checklist_touch
  before update on public.trip_checklist
  for each row execute function public.touch_row_version();

-- ---------------------------------------------------------------------- RLS

-- anon is revoked for the reason 0006 gives: these rows are private, and the
-- anon key ships inside the bundle.
revoke all on public.trip_checklist from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.trip_checklist to authenticated;

alter table public.trip_checklist enable row level security;

drop policy if exists "checklist rows are readable by their owner" on public.trip_checklist;
create policy "checklist rows are readable by their owner"
  on public.trip_checklist for select
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "signed in users add their own checklist rows" on public.trip_checklist;
create policy "signed in users add their own checklist rows"
  on public.trip_checklist for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "owners edit their own checklist rows" on public.trip_checklist;
create policy "owners edit their own checklist rows"
  on public.trip_checklist for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "owners remove their own checklist rows" on public.trip_checklist;
create policy "owners remove their own checklist rows"
  on public.trip_checklist for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- ------------------------------------------------------- access by trip code

create or replace function public.open_trip_checklist(p_code uuid)
returns table (
  local_id text,
  kind     text,
  label    text,
  done     boolean,
  heading  text,
  added_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select c.local_id, c.kind, c.label, c.done, c.heading, c.added_at
  from public.trip_checklist c
  join public.itineraries i on i.id = c.itinerary_id
  where i.share_code = p_code
$$;

comment on function public.open_trip_checklist(uuid) is
  'The packing and preparation lists for a trip, by the trip''s code.';

-- Replace a trip's lists with what the client holds.
--
-- Whole-list rather than row by row, for the reason save_trip_expenses gives:
-- "these are all the rows there are" is the only statement that also expresses
-- a deletion, and an item removed from a packing list has to actually go.
--
-- The delete is scoped by itinerary_id, so it can only ever reach the lists of
-- the trip whose code was supplied.
create or replace function public.save_trip_checklist(p_code uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip  uuid;
  v_owner uuid;
  v_count integer;
begin
  select i.id, i.owner_id into v_trip, v_owner
  from public.itineraries i where i.share_code = p_code;

  -- No trip, no lists. Silent rather than an error: the caller is a sync loop
  -- and a missing trip is a state it recovers from on its own.
  if v_trip is null then return 0; end if;

  -- Rows belong to whoever owns the trip, not to whoever is writing, so a
  -- second phone's ticks land where the first phone can see them.
  delete from public.trip_checklist c where c.itinerary_id = v_trip;

  insert into public.trip_checklist
    (owner_id, itinerary_id, local_id, kind, label, done, heading, added_at)
  select
    v_owner, v_trip,
    r ->> 'local_id',
    coalesce(nullif(r ->> 'kind', ''), 'packing'),
    left(coalesce(r ->> 'label', ''), 200),
    coalesce((r ->> 'done')::boolean, false),
    left(nullif(r ->> 'heading', ''), 60),
    coalesce(nullif(r ->> 'added_at', '')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

comment on function public.save_trip_checklist(uuid, jsonb) is
  'Replace a trip''s packing and preparation lists, by the trip''s code.';

-- Both are callable by anyone signed in, which with anonymous sign ins is every
-- visitor. That is the point: the code is what gates them, not the caller.
grant execute on function public.open_trip_checklist(uuid) to authenticated;
grant execute on function public.save_trip_checklist(uuid, jsonb) to authenticated;

-- ================================================================== checks

select * from (
  select 1 as ord, 'the table exists' as check, '' as found,
    case when to_regclass('public.trip_checklist') is not null
         then 'ok' else 'missing, the lists stay in one browser' end as status

  union all
  select 2, 'anon cannot read the lists', '',
    case when not exists (
           select 1 from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'trip_checklist' and grantee = 'anon')
         then 'ok' else 'anon holds a grant, revoke it' end

  union all
  select 3, 'row level security is on', '',
    case when (select relrowsecurity from pg_class where oid = 'public.trip_checklist'::regclass)
         then 'ok' else 'off, every row is readable by everyone' end

  union all
  select 4, 'four policies, one per verb', (
      select count(*)::text from pg_policies
      where schemaname = 'public' and tablename = 'trip_checklist'),
    case when (select count(*) from pg_policies
               where schemaname = 'public' and tablename = 'trip_checklist') = 4
         then 'ok' else 'expected 4' end

  union all
  select 5, 'the two code functions exist', '',
    case when to_regprocedure('public.open_trip_checklist(uuid)') is not null
          and to_regprocedure('public.save_trip_checklist(uuid, jsonb)') is not null
         then 'ok' else 'missing, a trip opened by code carries no lists' end

  union all
  select 6, 'rows stored', (select count(*)::text from public.trip_checklist), 'ok'
) t order by ord;
