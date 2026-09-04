-- The itinerary and the ledger, moved off the browser and onto the server.
--
-- Run after 0005_retire_hangzhou_karting.sql. Idempotent: safe to run more
-- than once.
--
-- 0001 said: "The itinerary itself is NOT here. It still lives in the browser,
-- per the original brief. Adding it later means one more migration, not a
-- rewrite." This is that migration.
--
-- What this adds:
--   itineraries    one row per trip, the trip itself held as jsonb
--   expenses       one row per thing paid for, not a document
--   user_settings  home currency and the rate the ledger converts at
--
-- Nothing here is readable by `anon`. The catalog is public and a trip is not:
-- 0001 and 0002 grant select to anon so a visitor can browse places without
-- signing in. A trip belongs to one person, so every grant below stops at
-- `authenticated`, and every policy narrows that to the owner.
--
-- On "signed in": this project uses Supabase anonymous sign ins, so every
-- browser silently holds a real auth.users row and a real auth.uid(). Owner
-- scoping therefore works with no sign in screen, and adding email sign in
-- later upgrades the same row, so none of this data has to move.

-- ============================================================== itineraries
--
-- The whole trip is one jsonb document, not a table of days and a table of
-- items. That is deliberate, and worth writing down, because the normalised
-- shape is the obvious one.
--
-- Every action in src/lib/store.ts rebuilds the entire days array, and the
-- persistence effect writes the whole itinerary on any change at all. There is
-- no diff anywhere in the client. A normalised schema would need one invented,
-- and undo would become "delete every row for this trip and re-insert a
-- snapshot", which resurrects day and item ids that were already handed out.
--
-- Ordering comes free. jsonb normalises object *keys*, sorting them and
-- dropping duplicates, but it preserves *array element order* exactly. So
-- days[] and items[] round trip untouched, which is why nothing here has a
-- position column. The corollary is a rule: never store days or items as an
-- object keyed by id, only as an array.

create table if not exists public.itineraries (
  -- Surrogate key, for the reason 0001 and 0003 both give: expenses point at
  -- this, and a trip name gets corrected. The uuid never moves.
  id          uuid primary key default gen_random_uuid(),

  owner_id    uuid not null default auth.uid()
                references auth.users (id) on delete cascade,

  -- The Itinerary from src/types.ts, verbatim: { name, days[] }. The client
  -- sends what it already holds in memory and reads it back the same way.
  doc         jsonb not null default '{"name": "My Trip", "days": []}'::jsonb,

  -- Exactly one trip is the one the app opens. Many rows per owner are allowed
  -- from day one, so a second trip is an insert rather than a migration, but
  -- the partial unique index below means the app never has to guess which to
  -- load and can never silently fork into two.
  is_active   boolean not null default true,

  -- 'app' for one built here. 'local-backup' for a copy lifted out of a
  -- browser, which lands archived rather than overwriting.
  source      text not null default 'app',

  -- Which browser wrote this last. Random, minted once and kept beside the
  -- trip. Never used for authorisation: it is what lets a device ignore the
  -- echo of its own write.
  client_id   text,

  -- Optimistic concurrency. Moved by the trigger, never by the client.
  version     integer not null default 1,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- When the client thinks it last changed this. A different clock from
  -- updated_at and not to be trusted for ordering. Display only.
  client_updated_at timestamptz,

  constraint itineraries_doc_object
    check (jsonb_typeof(doc) = 'object'),

  -- coalesce, not a bare jsonb_typeof: `doc -> 'days'` on a document with no
  -- days key is SQL NULL, jsonb_typeof(NULL) is NULL, and a check that
  -- evaluates to NULL passes. The default turns "missing" into a failure.
  constraint itineraries_doc_days_array
    check (coalesce(jsonb_typeof(doc -> 'days'), 'missing') = 'array'),

  -- A ceiling, not a schema. A note is free text and Postgres would happily
  -- store a pasted novel, but every save ships the whole document, so an
  -- unbounded one turns a keystroke into a megabyte upload.
  constraint itineraries_doc_size
    check (octet_length(doc::text) <= 1048576)
);

-- Only those structural checks, on purpose. A stricter one, every day has a
-- string id and an items array, would reject a write the client believes
-- succeeded. A constraint that can lock someone out of saving their trip is
-- the worse failure here.

-- Derived from the document, never written to. Same trick as places.tags_array
-- in 0003: one field to edit, derived fields that cannot drift from it because
-- Postgres computes them on write. Dropped and re-added rather than
-- `add column if not exists`, so the definitions can change, exactly as 0003
-- does for tags_array.

alter table public.itineraries drop column if exists name;
alter table public.itineraries add column name text
  generated always as (nullif(btrim(doc ->> 'name'), '')) stored;

-- Written with a case rather than a bare jsonb_array_length so it is total: the
-- check constraint above should make the else branch unreachable, but a
-- generated column and a check both run on write and the order is not worth
-- depending on.
alter table public.itineraries drop column if exists day_count;
alter table public.itineraries add column day_count integer
  generated always as (
    case when jsonb_typeof(doc -> 'days') = 'array'
         then jsonb_array_length(doc -> 'days')
         else 0 end
  ) stored;

comment on table public.itineraries is
  'One row per trip. The trip is the jsonb document; everything else is derived or bookkeeping.';
comment on column public.itineraries.doc is
  'The Itinerary from src/types.ts as the client writes it: { name, days[] }.';
comment on column public.itineraries.client_updated_at is
  'The client''s own clock. Display only, updated_at is the authority.';

-- One active trip per person. The app queries `where is_active` and gets one
-- row or none, with nothing to sort and no tie to break.
--
-- This is also the guard against forking. Two devices that both hold local data
-- and both try to claim the active slot cannot both succeed: the second insert
-- fails with 23505, and the client inserts it archived instead, so the copy
-- that lost is kept rather than thrown away.
create unique index if not exists itineraries_one_active_per_owner
  on public.itineraries (owner_id)
  where is_active;

-- One backup per browser per person, so re-running an import is a no-op rather
-- than a pile of identical copies. NULLs never conflict in a unique index, so
-- an import that forgets to set client_id can still duplicate: always send one.
create unique index if not exists itineraries_one_backup_per_client
  on public.itineraries (owner_id, client_id)
  where source = 'local-backup';

create index if not exists itineraries_owner_idx
  on public.itineraries (owner_id, updated_at desc);

-- ================================================================= expenses
--
-- Rows, not a document, and the reasoning is the opposite of the itinerary's.
--
-- src/lib/expenses.ts keeps the ledger apart from the plan on purpose: "The
-- trip is a plan and this is the receipt, so the two are stored apart: editing
-- one never rewrites the other, and clearing the plan does not throw away what
-- the trip actually cost." That separation is kept, and the link is
-- deliberately weak: itinerary_id is nullable and set null on delete, so
-- deleting a trip orphans its receipts rather than shredding them. A cascade
-- here would be precisely the thing that comment forbids.
--
-- Rows rather than one blob because nothing about an expense is positional.
-- sortExpenses derives the order from the date at read time. The list only
-- grows, the totals are aggregates, and the realistic concurrent edit is two
-- phones adding two different receipts in the same hour, which rows survive
-- and a shared document does not.

create table if not exists public.expenses (
  id            uuid primary key default gen_random_uuid(),

  owner_id      uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,

  -- Weak on purpose, per the note above.
  itinerary_id  uuid references public.itineraries (id) on delete set null,

  -- The id this row had in the browser, "exp-...". Lets an import upsert
  -- instead of duplicating, and lets it be run twice. Null for rows created
  -- after this migration, and nulls never collide in a unique constraint,
  -- which is exactly the behaviour wanted.
  local_id      text,

  -- A real date column, which means the client must send null and not '' for
  -- an unfilled row: Postgres rejects '' as a date, and Expense.date is
  -- deliberately allowed to be absent "while a row is being typed".
  spent_on      date,

  -- The seven the app knows. Deliberately not a check constraint: 0003 removed
  -- `city in ('shanghai','hangzhou')` for exactly this reason. An eighth
  -- category should not need a migration.
  category      text not null default 'other',
  label         text not null default '',

  -- numeric, not double precision. A ledger totalled in floating point gives a
  -- different answer depending on the order the rows came back in. Negative is
  -- allowed: a refund is a real thing that happens to a trip.
  amount        numeric(12,2) not null default 0,

  -- ISO 4217, uppercase, the same shape rule 0003 put on places.country.
  --
  -- Defaulted to CNY and not SGD, and this is load bearing. Expense.currency is
  -- optional, and src/lib/expenses.ts says rows written before the tracker knew
  -- about SGD "were all typed as yuan". inSgd reads an absent currency as CNY.
  -- Default this to SGD and every one of those rows silently becomes 5.45 times
  -- dearer, with nothing anywhere to notice it.
  currency      text not null default 'CNY',

  people        integer,
  note          text,

  client_id     text,
  source        text not null default 'app',
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  client_updated_at timestamptz,

  constraint expenses_currency_format    check (currency ~ '^[A-Z]{3}$'),
  constraint expenses_category_not_blank check (length(trim(category)) > 0),
  constraint expenses_people_positive    check (people is null or people > 0),
  constraint expenses_label_length       check (length(label) <= 200),
  constraint expenses_note_length        check (note is null or length(note) <= 4000),

  constraint expenses_one_row_per_local_id unique (owner_id, local_id)
);

-- nulls first, because sortExpenses puts undated rows at the top: "an expense
-- you have just typed is the one you are still looking at."
create index if not exists expenses_owner_idx
  on public.expenses (owner_id, spent_on desc nulls first);

create index if not exists expenses_itinerary_idx
  on public.expenses (itinerary_id);

comment on table public.expenses is
  'What the trip actually cost. Kept beside the itinerary, never inside it.';

-- ============================================================ user_settings
--
-- One row per person. The rate lives here rather than on the itinerary for the
-- same reason the ledger does not live inside it: an expense with no
-- itinerary_id still has to be worth something in Singapore dollars, and
-- deleting a trip must not silently re-value the whole ledger at the default.
--
-- Natural key, no surrogate, and that is not an oversight. 0001 and 0003 argue
-- for surrogate keys because a primary key is referenced by other tables and
-- must never change. Nothing references this table, and auth.users.id never
-- moves anyway, so the reason does not apply.

create table if not exists public.user_settings (
  user_id       uuid primary key default auth.uid()
                  references auth.users (id) on delete cascade,

  home_currency text not null default 'SGD',

  -- Units of the foreign currency per one unit of home_currency. 5.45 means
  -- 5.45 yuan to the Singapore dollar, which is DEFAULT_RATE in
  -- src/lib/expenses.ts.
  --
  -- A map rather than one number, because a bare 5.45 does not say which pair
  -- it is a rate for, and the whole thesis of 0003 is that a two value world
  -- hardcoded in one place is a migration waiting to happen. Today it has
  -- exactly one key.
  fx_rates      jsonb not null default '{"CNY": 5.45}'::jsonb,

  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint user_settings_home_currency_format
    check (home_currency ~ '^[A-Z]{3}$'),
  constraint user_settings_fx_rates_object
    check (jsonb_typeof(fx_rates) = 'object')
);

comment on table public.user_settings is
  'Per person preferences. Outlives any one trip, because the ledger does.';

-- ================================================================= triggers
--
-- touch_updated_at from 0002 is left exactly as it is. place_reviews uses it
-- and has no version column, so teaching that function about `version` would
-- break every review write with "record new has no field version". This is a
-- second function, for the tables that have one.

create or replace function public.touch_row_version()
returns trigger language plpgsql as $$
begin
  -- now() is the server's transaction timestamp, so updated_at is never a
  -- client clock and never skewed. Overwriting it here also means a client
  -- cannot backdate a row to win a comparison.
  new.updated_at = now();
  new.created_at = old.created_at;
  -- The client sends back whatever version it read; this is what moves it.
  -- Detection is the WHERE clause on the update, not this line, which is why a
  -- client can never fake its way past a conflict.
  new.version    = old.version + 1;
  return new;
end $$;

drop trigger if exists itineraries_touch on public.itineraries;
create trigger itineraries_touch
  before update on public.itineraries
  for each row execute function public.touch_row_version();

drop trigger if exists expenses_touch on public.expenses;
create trigger expenses_touch
  before update on public.expenses
  for each row execute function public.touch_row_version();

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch
  before update on public.user_settings
  for each row execute function public.touch_row_version();

-- ====================================================================== RLS
--
-- Supabase's default privileges grant anon and authenticated everything on a
-- new table in public, so the revokes below do real work rather than restating
-- a default. RLS would still stop anon, since no policy names it, but two locks
-- cost less than discovering one of them was mis-cut.
--
-- Not used here: `force row level security`. It would subject the table owner
-- to RLS too, and the Supabase SQL editor connects as that owner, so the checks
-- at the bottom of this file would come back empty and look like data loss.

revoke all on public.itineraries   from anon;
revoke all on public.expenses      from anon;
revoke all on public.user_settings from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.itineraries   to authenticated;
grant select, insert, update, delete on public.expenses      to authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;

alter table public.itineraries   enable row level security;
alter table public.expenses      enable row level security;
alter table public.user_settings enable row level security;

-- ------------------------------------------------------------- itineraries

drop policy if exists "trips are readable by their owner" on public.itineraries;
create policy "trips are readable by their owner"
  on public.itineraries for select
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "signed in users create their own trips" on public.itineraries;
create policy "signed in users create their own trips"
  on public.itineraries for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "owners edit their own trips" on public.itineraries;
create policy "owners edit their own trips"
  on public.itineraries for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "owners delete their own trips" on public.itineraries;
create policy "owners delete their own trips"
  on public.itineraries for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------- expenses
--
-- The write checks do more than owner_id. Without the second clause a user
-- could file their own expense against a stranger's itinerary_id: they still
-- could not read that trip, but deleting it would reach across and null a
-- column on somebody else's row. RLS expressions may contain subqueries,
-- unlike check constraints, so the reference is verified here.

drop policy if exists "expenses are readable by their owner" on public.expenses;
create policy "expenses are readable by their owner"
  on public.expenses for select
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "signed in users add their own expenses" on public.expenses;
create policy "signed in users add their own expenses"
  on public.expenses for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and (itinerary_id is null or exists (
          select 1 from public.itineraries i
          where i.id = itinerary_id and i.owner_id = (select auth.uid())))
  );

drop policy if exists "owners edit their own expenses" on public.expenses;
create policy "owners edit their own expenses"
  on public.expenses for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (itinerary_id is null or exists (
          select 1 from public.itineraries i
          where i.id = itinerary_id and i.owner_id = (select auth.uid())))
  );

drop policy if exists "owners delete their own expenses" on public.expenses;
create policy "owners delete their own expenses"
  on public.expenses for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- ----------------------------------------------------------- user_settings

drop policy if exists "settings are readable by their owner" on public.user_settings;
create policy "settings are readable by their owner"
  on public.user_settings for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "signed in users create their own settings" on public.user_settings;
create policy "signed in users create their own settings"
  on public.user_settings for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "owners edit their own settings" on public.user_settings;
create policy "owners edit their own settings"
  on public.user_settings for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "owners delete their own settings" on public.user_settings;
create policy "owners delete their own settings"
  on public.user_settings for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ================================================================== checks
-- Read only. Everything above should report ok.

select * from (
  select 1 as ord, 'tables' as check,
    (select count(*)::text from information_schema.tables
      where table_schema = 'public'
        and table_name in ('itineraries', 'expenses', 'user_settings')) as found,
    case when (select count(*) from information_schema.tables
               where table_schema = 'public'
                 and table_name in ('itineraries', 'expenses', 'user_settings')) = 3
         then 'ok' else 'expected 3' end as status

  union all
  select 2, 'row level security on', count(*)::text,
    case when count(*) = 3 then 'ok' else 'expected 3' end
  from pg_tables
  where schemaname = 'public'
    and tablename in ('itineraries', 'expenses', 'user_settings')
    and rowsecurity

  union all
  select 3, 'owner policies', count(*)::text,
    case when count(*) = 12 then 'ok' else 'expected 12' end
  from pg_policies
  where schemaname = 'public'
    and tablename in ('itineraries', 'expenses', 'user_settings')

  union all
  select 4, 'anon has no grant on your trip', '',
    case
      when has_table_privilege('anon', 'public.itineraries',   'SELECT')
        or has_table_privilege('anon', 'public.expenses',      'SELECT')
        or has_table_privilege('anon', 'public.user_settings', 'SELECT')
      then 'OPEN TO THE INTERNET, re-run the revoke block'
      else 'ok'
    end

  union all
  select 5, 'anon named in no policy', '',
    case
      when exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename in ('itineraries', 'expenses', 'user_settings')
          and 'anon' = any (roles)
      ) then 'OPEN TO THE INTERNET, anyone could read your trip'
      else 'ok'
    end

  union all
  select 6, 'one active trip per person', '',
    case when exists (select 1 from pg_indexes
                      where schemaname = 'public'
                        and indexname = 'itineraries_one_active_per_owner')
         then 'ok' else 'missing, two devices could fork the trip' end

  union all
  select 7, 'version triggers',
    (select count(*)::text from pg_trigger
      where not tgisinternal
        and tgname in ('itineraries_touch', 'expenses_touch', 'user_settings_touch')),
    case when (select count(*) from pg_trigger
               where not tgisinternal
                 and tgname in ('itineraries_touch', 'expenses_touch', 'user_settings_touch')) = 3
         then 'ok' else 'expected 3, conflict detection will not work' end

  union all
  select 8, 'reviews trigger still intact', '',
    case when exists (select 1 from pg_proc p
                      join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = 'touch_updated_at')
         then 'ok' else '0002 function was dropped, reviews cannot be edited' end

  union all
  select 9, 'expense currency defaults to CNY', '',
    case when (select column_default from information_schema.columns
               where table_schema = 'public' and table_name = 'expenses'
                 and column_name = 'currency') like '%CNY%'
         then 'ok' else 'WRONG, old rows would be revalued 5.45x' end

  union all
  select 10, 'trips stored', coalesce((select count(*)::text from public.itineraries), '0'), 'ok'
  union all
  select 11, 'expenses stored', coalesce((select count(*)::text from public.expenses), '0'), 'ok'
) t order by ord;
