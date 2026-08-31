-- Remove the eight rows the old extraction left behind.
--
-- Run after seed.sql. Idempotent: running it twice deletes nothing the second
-- time.
--
-- The seed writes with `on conflict (slug) do update`, which is right for
-- corrections and wrong for renames: it never deletes. When the extractor
-- started reading the planner's own data, eight places arrived under better
-- names, and their old rows stayed behind as duplicates:
--
--   west-lake                                  -> west-lake-and-bai-causeway
--   lingyin-temple                             -> lingyin-temple-and-feilai-peak
--   in77                                       -> hubin-in77-malls
--   tea-plantation-day                         -> longjing-village-tea-terraces
--   lujiazui-skyline                           -> shanghai-tower-observation-deck
--   wukang-road-and-the-former-french-concession -> former-french-concession
--   disneyland                                 -> shanghai-disneyland
--   nanxiang-steamed-bun-2                     -> nanxiang-steamed-bun
--
-- Two of those were categorised as activities, which is why the activities
-- page counted 28 in Shanghai and 2 in Hangzhou against the 27 and 1 the
-- catalog holds.
--
-- Two guards. A place someone added in the app is never touched, whatever it
-- is called. A place carrying reviews is left alone too: place_reviews
-- cascades on delete, and a stale name is a smaller problem than a deleted
-- review. Anything skipped is listed at the end.

begin;

delete from public.places
where slug in (
        'west-lake',
        'lingyin-temple',
        'in77',
        'tea-plantation-day',
        'lujiazui-skyline',
        'wukang-road-and-the-former-french-concession',
        'disneyland',
        'nanxiang-steamed-bun-2'
      )
  and source <> 'user'
  and not exists (
        select 1 from public.place_reviews r where r.place_id = public.places.id
      );

commit;

-- Anything left here needs a decision rather than a delete: move the review
-- over to the new row by hand, then remove the old one.
select
  slug,
  name_en,
  source,
  (select count(*) from public.place_reviews r where r.place_id = p.id) as reviews
from public.places p
where slug in (
  'west-lake',
  'lingyin-temple',
  'in77',
  'tea-plantation-day',
  'lujiazui-skyline',
  'wukang-road-and-the-former-french-concession',
  'disneyland',
  'nanxiang-steamed-bun-2'
);
