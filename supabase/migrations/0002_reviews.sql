-- Your own reviews, and the area data needed to compare places across areas.
-- Run this in the Supabase SQL editor after 0001_catalog.sql and seed.sql.
--
-- What this adds:
--   districts.sort_order, .lat, .lng   ordering and rough centre for each area
--   places.lat, .lng, .booking_note    where a place is, and how to get in
--   place_reviews                      the reviews you write yourself
--   place_area_stats                   per area rollup, for deciding across areas
--
-- Idempotent: safe to run more than once.

-- ------------------------------------------------------------------- areas
-- "Area" is the district. The catalog already carries one per place, so this
-- only adds what area-level comparison needs: a stable display order, and a
-- rough centre so places can later be sorted by distance from an area.

alter table public.districts add column if not exists sort_order integer not null default 100;
alter table public.districts add column if not exists lat numeric(9,6);
alter table public.districts add column if not exists lng numeric(9,6);

comment on column public.districts.sort_order is
  'Display order within a city. Lower sorts first. Ties fall back to name_en.';

-- ------------------------------------------------------------------ places

alter table public.places add column if not exists lat numeric(9,6);
alter table public.places add column if not exists lng numeric(9,6);

-- Things that decide whether you can actually go, as opposed to whether you
-- want to. Kept free text on purpose: opening hours in these sources are
-- irregular enough ("closed 2nd Tuesday", "last order 21:00") that a
-- structured column would lose more than it gained.
alter table public.places add column if not exists booking_note text;
alter table public.places add column if not exists hours_note   text;
alter table public.places add column if not exists closed_note  text;

comment on column public.places.booking_note is
  'How to get in: walk-in, WeChat booking, queue app, reserve N days ahead.';

-- ----------------------------------------------------------- place_reviews
-- One review per person per place. Written after visiting, edited freely.
--
-- Deliberately separate from places rather than columns on it: a review is
-- yours and dated, a place is a fact about the world. Keeping them apart
-- means re-running seed.sql can never overwrite something you wrote.

create table if not exists public.place_reviews (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places (id) on delete cascade,

  -- The headline. 1 to 5, and a plain verdict, because a number alone stops
  -- meaning anything six months later.
  rating      smallint check (rating is null or rating between 1 and 5),
  verdict     text check (verdict is null or verdict in
                ('must-return', 'worth-it', 'fine', 'skip')),

  body        text not null default '',   -- what you actually thought
  order_this  text,                       -- what to order, or what to skip
  tip         text,                       -- queue at 11:30, sit upstairs, cash only

  visited_on     date,
  price_paid     integer check (price_paid is null or price_paid >= 0),  -- RMB per person
  wait_minutes   integer check (wait_minutes is null or wait_minutes >= 0),
  would_return   boolean,

  -- Storage paths in a Supabase bucket, not data URIs. Empty until photos
  -- are wired up; the column exists so adding them is not a migration.
  photo_paths text[] not null default '{}',

  author_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- One review per place per person. Editing means updating this row, so
  -- the app can upsert on (place_id, author_id) and never create duplicates.
  constraint place_reviews_one_per_author unique (place_id, author_id)
);

create index if not exists place_reviews_place_idx  on public.place_reviews (place_id);
create index if not exists place_reviews_author_idx on public.place_reviews (author_id);
create index if not exists place_reviews_rating_idx on public.place_reviews (rating desc nulls last);

comment on table public.place_reviews is
  'Reviews written by hand after visiting. Never touched by seed.sql.';

-- Keep updated_at honest without the client having to remember.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists place_reviews_touch on public.place_reviews;
create trigger place_reviews_touch
  before update on public.place_reviews
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- rollups
-- One row per place with its review summary already joined, so the library
-- can sort by rating without a second query or a client side join.

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

-- The "decide across areas" query: how many places, how good, how dear, per
-- area. Small enough to fetch whole and sort in the browser.
create or replace view public.place_area_stats as
select
  d.id                     as district_id,
  d.city,
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
left join public.places p        on p.district_id = d.id
left join public.place_reviews pr on pr.place_id = p.id
group by d.id, d.city, d.name_zh, d.name_en, d.sort_order;

-- -------------------------------------------------------------------- RLS
-- Reviews are readable by anyone (the site is browsable without signing in)
-- and writable only by their author. Views inherit the policies of the
-- tables underneath, so they need no policies of their own.

grant select on public.place_reviews to anon, authenticated;
grant insert, update, delete on public.place_reviews to authenticated;
grant select on public.place_with_review, public.place_area_stats to anon, authenticated;

alter table public.place_reviews enable row level security;

drop policy if exists "reviews are readable by everyone" on public.place_reviews;
create policy "reviews are readable by everyone"
  on public.place_reviews for select
  using (true);

drop policy if exists "signed in users write their own reviews" on public.place_reviews;
create policy "signed in users write their own reviews"
  on public.place_reviews for insert
  to authenticated
  with check (author_id = auth.uid());

drop policy if exists "authors edit their own reviews" on public.place_reviews;
create policy "authors edit their own reviews"
  on public.place_reviews for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists "authors delete their own reviews" on public.place_reviews;
create policy "authors delete their own reviews"
  on public.place_reviews for delete
  to authenticated
  using (author_id = auth.uid());

-- Note on writing reviews: this needs a signed in user, because author_id
-- defaults to auth.uid() and the policies check it. Supabase magic link
-- sign in is the smallest thing that satisfies that. Until auth is wired up
-- the table accepts no writes at all, which is the safe direction to fail:
-- the anon key ships inside the bundle, so a policy open to `anon` would be
-- an open write endpoint on the public internet.
