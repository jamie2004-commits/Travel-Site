-- Remove the Hangzhou activities the catalog no longer carries.
--
-- Run after seed.sql. Idempotent: running it twice deletes nothing the second
-- time. Nothing here touches Shanghai.
--
-- Three groups go, all of them Hangzhou:
--
--   the six go-karting venues       量子空间, F2万奥, 星耀7号, 迪赛, 千岛湖燃擎, PARTYDAY
--   four of the five escape rooms   VR Escape Rooms, OMG, GY-BOX, Xcape
--   six rows renamed in place       place-3 .. place-11
--
-- On the renames: those cards had no English name in the source, so the
-- extractor slugged them place-3, place-4 and so on. They now carry a real
-- name and a real slug, and the seed writes the new rows rather than moving
-- the old ones, so the old slugs are deleted here:
--
--   place-3   暴风岛次时代密室      -> storm-island-next-gen-escape-rooms
--   place-4   幻觉沉浸式剧场        -> hallucination-immersive-theatre
--   place-5   量子空间竞技主题乐园   -> gone, karting
--   place-6   杭州迪赛卡丁车        -> gone, karting
--   place-7   千岛湖燃擎卡丁车俱乐部 -> gone, karting
--   place-8   宋城 · 千古情         -> songcheng-romance-show
--   place-9   印象西湖 · 最忆是杭州  -> impression-west-lake
--   place-10  垂云通天河            -> chuiyun-underground-river
--   place-11  红博苑户外营地        -> hongboyuan-outdoor-camp
--
-- place-2 is Guai Tan Wu in Shanghai and stays. The city clause below is what
-- keeps it, so do not drop it from the delete.
--
-- Two guards, the same pair 0004 uses. A place someone added in the app is
-- never touched, whatever it is called. A place carrying reviews is left
-- alone too: place_reviews cascades on delete, and a stale row is a smaller
-- problem than a deleted review. Anything skipped is listed at the end.

begin;

delete from public.places
where city = 'hangzhou'
  and slug in (
        'place-3',
        'place-4',
        'place-5',
        'place-6',
        'place-7',
        'place-8',
        'place-9',
        'place-10',
        'place-11',
        '7',
        'f2',
        'partyday',
        'vr-escape-rooms',
        'omg',
        'gy-box',
        'xcape'
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
  name_zh,
  name_en,
  source,
  (select count(*) from public.place_reviews r where r.place_id = p.id) as reviews
from public.places p
where city = 'hangzhou'
  and slug in (
    'place-3', 'place-4', 'place-5', 'place-6', 'place-7', 'place-8',
    'place-9', 'place-10', 'place-11',
    '7', 'f2', 'partyday', 'vr-escape-rooms', 'omg', 'gy-box', 'xcape'
  );
