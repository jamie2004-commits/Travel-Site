-- Is this project set up? Paste the whole thing into the Supabase SQL editor.
--
-- If you get "ERROR: relation "public.places" does not exist", that is your
-- answer: migrations/0001_catalog.sql has not been run yet.

select
  'districts rows' as check,
  count(*)::text as found,
  case when count(*) = 15 then 'ok' else 'expected 15, re-run seed.sql' end as status
from public.districts

union all
select
  'places rows',
  count(*)::text,
  case
    when count(*) = 0 then 'empty, run seed.sql'
    when count(*) < 103 then 'expected at least 103, re-run seed.sql'
    else 'ok'
  end
from public.places

union all
select
  'row level security on',
  count(*)::text,
  case when count(*) = 2 then 'ok' else 'expected 2, re-run the migration' end
from pg_tables
where schemaname = 'public'
  and tablename in ('districts', 'places')
  and rowsecurity

union all
select
  'policies',
  count(*)::text,
  case when count(*) >= 5 then 'ok' else 'expected 5, re-run the migration' end
from pg_policies
where schemaname = 'public'
  and tablename in ('districts', 'places')

union all
select
  'anon can read places',
  '',
  case
    when exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'places' and cmd = 'SELECT'
    ) then 'ok'
    else 'missing, the site would show nothing'
  end

union all
select
  'anon cannot write places',
  '',
  case
    when exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'places'
        and cmd <> 'SELECT'
        and 'anon' = any (roles)
    ) then 'OPEN TO THE INTERNET, anyone can write'
    else 'ok'
  end

union all
select
  'a sample place',
  coalesce((select name_zh || ' / ' || name_en from public.places where slug = 'the-bund'), 'not found'),
  case
    when exists (select 1 from public.places where slug = 'the-bund') then 'ok'
    else 'seed did not land'
  end

union all
select
  'place_reviews table',
  '',
  case
    when exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'place_reviews')
    then 'ok'
    else 'missing, run migrations/0002_reviews.sql'
  end

union all
select
  'review rollup views',
  (select count(*)::text from information_schema.views
   where table_schema = 'public'
     and table_name in ('place_with_review', 'place_area_stats')),
  case
    when (select count(*) from information_schema.views
          where table_schema = 'public'
            and table_name in ('place_with_review', 'place_area_stats')) = 2
    then 'ok'
    else 'expected 2, run migrations/0002_reviews.sql'
  end

union all
select
  'your reviews so far',
  coalesce((select count(*)::text from public.place_reviews), '0'),
  'ok'

union all
select
  'anon cannot write reviews',
  '',
  case
    when exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'place_reviews'
        and cmd <> 'SELECT'
        and 'anon' = any (roles)
    ) then 'OPEN TO THE INTERNET, anyone can write'
    else 'ok'
  end

union all
select
  'international ready',
  (select count(distinct country)::text from public.places),
  case
    when exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='places'
                   and column_name='tags_array')
    then 'ok'
    else 'missing, run migrations/0003_places_extensible.sql'
  end

union all
select
  'duplicate guard',
  '',
  case
    when exists (select 1 from pg_indexes
                 where schemaname='public' and indexname='places_natural_key')
    then 'ok'
    else 'missing, run migrations/0003_places_extensible.sql'
  end

union all
select
  'places with no real area',
  (select count(*)::text from public.places where district_id like '%-other'),
  case
    when (select count(*) from public.places where district_id like '%-other') = 0 then 'ok'
    else 'these cannot be compared across areas'
  end

order by 1;
