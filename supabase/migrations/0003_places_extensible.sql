-- Make places hold a full record of a place, and make the catalog able to
-- leave China without a rewrite.
--
-- Run after 0002_reviews.sql. Idempotent: safe to run more than once.
--
-- What changes:
--   name_zh becomes optional      a place in Osaka or Lisbon has no Chinese name
--   city stops being an enum      'shanghai' | 'hangzhou' was a two city guess
--   country arrives               defaults to CN, so existing rows are correct
--   address_zh becomes address    it holds an address, in whatever script
--   tags become a comma list      one editable field, as typed by hand
--   a natural key arrives         name + city + address must be unique
--
-- On the primary key: this deliberately does NOT make (name_en, city,
-- address) the primary key, though it does make that combination unique,
-- which is what duplicate prevention actually needs. A primary key is
-- referenced by other tables (place_reviews.place_id today, itinerary items
-- later) and must never change. Names and addresses get corrected: a typo
-- fixed in an address would silently break every review pointing at it.
-- The uuid never changes, so corrections stay cheap.

-- ------------------------------------------------------------- views first
-- The views from 0002 select p.*, which makes them depend on every column of
-- places by name. Postgres refuses to rename or drop a column underneath a
-- view, so they come down here and go back up at the bottom, once the new
-- shape is settled.

drop view if exists public.place_with_review;
drop view if exists public.place_area_stats;

-- ------------------------------------------------------- international-ready

-- A Chinese name is now optional. Everything outside the Sinosphere has none.
alter table public.places alter column name_zh drop not null;

-- city was `check (city in ('shanghai','hangzhou'))` on both tables. Adding a
-- third city should not require a migration, so the enum goes and a non-empty
-- check replaces it.
alter table public.places    drop constraint if exists places_city_check;
alter table public.districts drop constraint if exists districts_city_check;

alter table public.places    drop constraint if exists places_city_not_blank;
alter table public.districts drop constraint if exists districts_city_not_blank;

alter table public.places    add constraint places_city_not_blank    check (length(trim(city)) > 0);
alter table public.districts add constraint districts_city_not_blank check (length(trim(city)) > 0);

-- ISO 3166-1 alpha-2. Existing rows are all China, hence the default.
alter table public.places    add column if not exists country text not null default 'CN';
alter table public.districts add column if not exists country text not null default 'CN';

alter table public.places drop constraint if exists places_country_format;
alter table public.places add constraint places_country_format
  check (country ~ '^[A-Z]{2}$');

comment on column public.places.country is
  'ISO 3166-1 alpha-2, uppercase. CN for everything migrated from the guides.';

-- ------------------------------------------------------------------- address
-- address_zh promised Chinese. The column holds whatever script the country
-- writes in, so the name was a lie waiting to happen.

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'places'
               and column_name = 'address_zh')
     and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'places'
                       and column_name = 'address')
  then
    alter table public.places rename column address_zh to address;
  end if;
end $$;

alter table public.places add column if not exists address text;

-- ---------------------------------------------------------------------- tags
-- Tags become a single comma separated field, so they can be typed and
-- corrected by hand in one box, in the app or in the Supabase table editor.
--
-- Querying a comma separated string is slow and error prone, so the array is
-- kept too, generated from the text rather than maintained alongside it. One
-- field to edit, and a GIN index to search. They cannot drift apart, because
-- Postgres computes the array on write.

do $$
begin
  -- First run: tags is still the text[] from 0001. Convert it in place.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'places'
               and column_name = 'tags' and data_type = 'ARRAY')
  then
    alter table public.places rename column tags to tags_legacy_array;
    alter table public.places add column tags text not null default '';
    update public.places set tags = array_to_string(tags_legacy_array, ', ');
    alter table public.places drop column tags_legacy_array;
  end if;
end $$;

alter table public.places add column if not exists tags text not null default '';

comment on column public.places.tags is
  'Comma separated, as typed. "Noodles, Michelin, Late night". Edit this one.';

-- Generated, never written to directly. Drops the whitespace around each
-- comma and the blanks a trailing comma would otherwise leave behind.
--
-- Written without a subquery on purpose: a generated column may only call
-- immutable functions and may not contain a select, so the usual
-- unnest-and-trim is not available. Collapsing the padding around every
-- comma before the split gets to the same place.
alter table public.places drop column if exists tags_array;
alter table public.places add column tags_array text[]
  generated always as (
    array_remove(
      string_to_array(
        btrim(regexp_replace(tags, '\s*,\s*', ',', 'g')),
        ','
      ),
      ''
    )
  ) stored;

comment on column public.places.tags_array is
  'Generated from tags. Search against this, never write to it.';

create index if not exists places_tags_gin on public.places using gin (tags_array);

-- ---------------------------------------------------------- the natural key
-- What makes a place the same place: its English name, where it is, and its
-- address. Unique rather than primary, per the note at the top.
--
-- Case and surrounding whitespace should not create a second row, so the
-- index is on the folded values. coalesce keeps a null address from making
-- every addressless row unique to itself, which is how nulls behave in a
-- plain unique constraint and is not what is wanted here.

create unique index if not exists places_natural_key
  on public.places (
    lower(trim(name_en)),
    lower(trim(city)),
    lower(trim(coalesce(address, '')))
  );

comment on index public.places_natural_key is
  'Same English name, same city, same address means the same place.';

-- Name and city are the minimum for a place to mean anything.
alter table public.places drop constraint if exists places_name_en_not_blank;
alter table public.places add constraint places_name_en_not_blank
  check (length(trim(name_en)) > 0);

-- ----------------------------------------------------------------- rollups
-- Rebuilt because the underlying columns moved. `select p.*` picks up the new
-- shape, so this is the same definition as 0002 with the column list refreshed.

create or replace view public.place_with_review as
select
  p.*,
  d.name_zh    as district_name_zh,
  d.name_en    as district_name_en,
  d.sort_order as district_sort_order,
  r.avg_rating,
  r.review_count,
  r.last_visited_on
from public.places p
join public.districts d on d.id = p.district_id
left join lateral (
  select
    round(avg(rating)::numeric, 1) as avg_rating,
    count(*)                       as review_count,
    max(visited_on)                as last_visited_on
  from public.place_reviews pr
  where pr.place_id = p.id
) r on true;

create or replace view public.place_area_stats as
select
  d.id                     as district_id,
  d.city,
  d.country,
  d.name_zh,
  d.name_en,
  d.sort_order,
  count(p.id)                                              as place_count,
  count(*) filter (where p.category = 'food')              as food_count,
  count(*) filter (where p.category = 'sight')             as sight_count,
  count(*) filter (where p.category = 'activity')          as activity_count,
  count(*) filter (where p.category = 'shopping')          as shopping_count,
  round(avg(pr.rating)::numeric, 1)                        as avg_rating,
  count(pr.id)                                             as review_count,
  round(avg((p.price_min + p.price_max) / 2.0)::numeric, 0) as avg_price
from public.districts d
left join public.places p         on p.district_id = d.id
left join public.place_reviews pr on pr.place_id = p.id
group by d.id, d.city, d.country, d.name_zh, d.name_en, d.sort_order;

grant select on public.place_with_review, public.place_area_stats to anon, authenticated;
