-- Is this project set up? Paste the whole thing into the Supabase SQL editor.
--
-- If you get "ERROR: relation "public.places" does not exist", that is your
-- answer: migrations/0001_catalog.sql has not been run yet.

select
  'districts rows' as check,
  count(*)::text as found,
  case when count(*) = 13 then 'ok' else 'expected 13, re-run seed.sql' end as status
from public.districts

union all
select
  'places rows',
  count(*)::text,
  case
    when count(*) = 0 then 'empty, run seed.sql'
    when count(*) < 96 then 'expected at least 96, re-run seed.sql'
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

order by 1;
