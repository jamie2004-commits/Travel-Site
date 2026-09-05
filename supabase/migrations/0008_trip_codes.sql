-- Let a trip be opened on another machine, without a sign in.
--
-- Run after 0007_open_catalog.sql. Idempotent: safe to run more than once.
--
-- The problem this solves. 0006 scopes a trip to `owner_id = auth.uid()`, and
-- with anonymous sign ins that id lives in one browser's local storage. So the
-- trip is durable, and completely unreachable from a second laptop: a different
-- browser is a different person as far as the database is concerned. That is
-- correct and it is also not what anyone wants from a trip they are planning.
--
-- The shape of the answer: a trip carries a code. Knowing the code is what
-- grants access, the way a document link does. Two things follow from that and
-- both are deliberate.
--
--   The code is a random uuid, not the date and the city. A readable key is a
--   guessable one, and a trip holds flight numbers, seat numbers, hotel phone
--   numbers and booking references. The date and the city are a *label*, for
--   recognising a trip in a list. They are not the key.
--
--   Access by code cannot be a row level security policy, because a policy
--   cannot ask "did the caller supply the right code" -- it only sees who is
--   asking. So the two functions below are `security definer`: they run as
--   their owner, take the code as an argument, and hand back only the row it
--   names. The code IS the permission. Everything without a code stays exactly
--   as 0006 left it: owner scoped, invisible to everyone else.

-- ---------------------------------------------------------------- the code

alter table public.itineraries
  add column if not exists share_code uuid not null default gen_random_uuid();

-- Unique so a code names one trip, and indexed because both functions below
-- look a trip up by it on every call.
create unique index if not exists itineraries_share_code_key
  on public.itineraries (share_code);

-- What a person reads to tell one trip from another: "Hangzhou and Shanghai,
-- 17 Sep 2026". Written by the client, because only the client knows which of
-- the days is the one worth naming. Never used to find a trip.
alter table public.itineraries add column if not exists label text;

comment on column public.itineraries.share_code is
  'The key that opens this trip from another browser. Knowing it is the permission.';
comment on column public.itineraries.label is
  'For recognising a trip in a list. Not a key: it is guessable by design.';

-- --------------------------------------------------------------- open by code
--
-- security definer, so it can return a row the caller does not own. It is
-- narrow on purpose: one argument, one row, and no way to ask for a list.
-- Guessing a v4 uuid is not a thing anyone does.
--
-- `set search_path = public, pg_temp` because a security definer function that
-- inherits the caller's search_path can be pointed at a different schema's
-- tables. Standard hardening, and easy to leave out.

create or replace function public.open_trip(p_code uuid)
returns table (
  id uuid,
  doc jsonb,
  version integer,
  label text,
  updated_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select i.id, i.doc, i.version, i.label, i.updated_at
  from public.itineraries i
  where i.share_code = p_code
$$;

comment on function public.open_trip(uuid) is
  'Read a trip by its code, from any browser. The code is the permission.';

-- --------------------------------------------------------------- save by code
--
-- The same compare and swap 0006 is built around, reached by code rather than
-- by ownership. Returns the new version, or nothing when p_expected_version no
-- longer matches, which is exactly how the client already reads a conflict.
--
-- Deliberately does NOT let a caller change owner_id, is_active or share_code.
-- Knowing the code buys editing the trip, not taking it over.

create or replace function public.save_trip(
  p_code uuid,
  p_doc jsonb,
  p_expected_version integer,
  p_label text default null,
  p_client_id text default null
)
returns table (version integer, updated_at timestamptz)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.itineraries i
     set doc = p_doc,
         label = coalesce(p_label, i.label),
         client_id = coalesce(p_client_id, i.client_id),
         client_updated_at = now()
   where i.share_code = p_code
     and i.version = p_expected_version
  returning i.version, i.updated_at
$$;

comment on function public.save_trip(uuid, jsonb, integer, text, text) is
  'Write a trip by its code, refusing when the version has moved. Cannot change who owns it.';

-- ------------------------------------------------------ the ledger, by code
--
-- The trip travels and the ledger has to travel with it. Without these, a trip
-- opened on a second laptop arrives with its days and none of what it cost,
-- because `expenses` is owner scoped exactly like `itineraries` was.
--
-- Scoped to one trip, not to one person. Before this the reconcile below read
-- every row the caller owned, which is correct for one trip and quietly wrong
-- for two: switching between them would delete the other's ledger.

create or replace function public.open_trip_expenses(p_code uuid)
returns table (
  local_id text,
  spent_on date,
  category text,
  label text,
  amount numeric,
  currency text,
  people integer,
  note text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select e.local_id, e.spent_on, e.category, e.label,
         e.amount, e.currency, e.people, e.note
  from public.expenses e
  join public.itineraries i on i.id = e.itinerary_id
  where i.share_code = p_code
$$;

comment on function public.open_trip_expenses(uuid) is
  'The ledger for a trip, by the trip''s code. Travels with it.';

-- Replace a trip's ledger with what the client holds.
--
-- Whole-ledger rather than row by row, because "these are all the rows there
-- are" is the only statement that also expresses a deletion, and a deleted
-- expense has to actually go. A ledger is tens of rows.
--
-- The delete is scoped by itinerary_id, so it can only ever reach the ledger of
-- the trip whose code was supplied. It cannot touch another trip's rows, or
-- another person's.
create or replace function public.save_trip_expenses(p_code uuid, p_rows jsonb)
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

  -- No trip, no ledger. Silent rather than an error: the caller is a sync loop
  -- and a missing trip is a state it recovers from on its own.
  if v_trip is null then return 0; end if;

  -- Rows belong to whoever owns the trip, not to whoever is writing. Otherwise
  -- a second laptop's edits would land under its own anonymous identity and be
  -- invisible to the first.
  delete from public.expenses e where e.itinerary_id = v_trip;

  insert into public.expenses
    (owner_id, itinerary_id, local_id, spent_on, category, label, amount, currency, people, note)
  select
    v_owner, v_trip,
    r ->> 'local_id',
    nullif(r ->> 'spent_on', '')::date,
    coalesce(nullif(r ->> 'category', ''), 'other'),
    coalesce(r ->> 'label', ''),
    coalesce((r ->> 'amount')::numeric, 0),
    coalesce(nullif(r ->> 'currency', ''), 'CNY'),
    nullif(r ->> 'people', '')::integer,
    r ->> 'note'
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

comment on function public.save_trip_expenses(uuid, jsonb) is
  'Replace a trip''s ledger, by the trip''s code. Scoped to that one trip.';

-- Both are callable by anyone signed in, which with anonymous sign ins is every
-- visitor. That is the point: the code is what gates them, not the caller.
-- NOT granted to `anon`, so a request with no session at all cannot use them,
-- which keeps them out of reach of the raw bundled key alone.
revoke all on function public.open_trip(uuid) from public, anon;
revoke all on function public.save_trip(uuid, jsonb, integer, text, text) from public, anon;
revoke all on function public.open_trip_expenses(uuid) from public, anon;
revoke all on function public.save_trip_expenses(uuid, jsonb) from public, anon;

grant execute on function public.open_trip(uuid) to authenticated;
grant execute on function public.save_trip(uuid, jsonb, integer, text, text) to authenticated;
grant execute on function public.open_trip_expenses(uuid) to authenticated;
grant execute on function public.save_trip_expenses(uuid, jsonb) to authenticated;

-- ================================================================== checks

select * from (
  select 1 as ord, 'share_code column' as check, '' as found,
    case when exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'itineraries'
                        and column_name = 'share_code')
         then 'ok' else 'missing' end as status

  union all
  select 2, 'every trip has a code',
    (select count(*)::text from public.itineraries where share_code is not null),
    case when (select count(*) from public.itineraries where share_code is null) = 0
         then 'ok' else 'some rows have none' end

  union all
  select 3, 'codes are unique', '',
    case when exists (select 1 from pg_indexes
                      where schemaname = 'public' and indexname = 'itineraries_share_code_key')
         then 'ok' else 'missing, a code could name two trips' end

  union all
  select 4, 'all four functions exist',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('open_trip', 'save_trip', 'open_trip_expenses', 'save_trip_expenses')),
    case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and p.proname in ('open_trip','save_trip','open_trip_expenses','save_trip_expenses')) = 4
         then 'ok' else 'expected 4' end

  union all
  select 5, 'they run as owner, which is what lets a code work', '',
    case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname in ('open_trip', 'save_trip')
                 and p.prosecdef) = 2
         then 'ok' else 'not security definer, a code would not open anything' end

  union all
  select 6, 'anon cannot call them', '',
    case when has_function_privilege('anon', 'public.open_trip(uuid)', 'EXECUTE')
         then 'OPEN TO THE INTERNET without a session'
         else 'ok' end

  union all
  select 7, 'a signed in visitor can', '',
    case when has_function_privilege('authenticated', 'public.open_trip(uuid)', 'EXECUTE')
         then 'ok' else 'missing, opening by code would fail' end

  union all
  select 8, 'trips stored', (select count(*)::text from public.itineraries), 'ok'

  union all
  select 9, 'expenses stored', (select count(*)::text from public.expenses), 'ok'

  union all
  select 10, 'every expense belongs to a trip',
    (select count(*)::text from public.expenses where itinerary_id is null),
    case when (select count(*) from public.expenses where itinerary_id is null) = 0
         then 'ok'
         else 'these will not travel with a trip code' end
) t order by ord;
