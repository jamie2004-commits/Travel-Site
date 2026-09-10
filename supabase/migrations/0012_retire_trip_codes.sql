-- Take away the trip code's power to open a trip.
--
-- Run after 0011_accounts_and_trips.sql, and AFTER the build that goes with it
-- is deployed and both devices have loaded it. Not before, and the gap is not
-- theoretical: a device still running the old bundle writes through save_trip,
-- and the moment this file runs those writes start failing. The trip is safe --
-- the old client keeps every edit in its own storage and reports the failure --
-- but nothing it does reaches the server until it is reloaded.
--
-- The safe order is: 0011, deploy, load the app on every device, then this.
--
-- ----------------------------------------------------------- what this is
--
-- 0008 made a trip reachable from a second browser by making knowledge of a
-- uuid the permission. That was the only way to do it without a sign in, and
-- everything about it followed from that constraint: the functions are
-- `security definer` precisely so they can hand back a row the caller does not
-- own, because the caller was always going to be a stranger to the database.
--
-- With email sign in the caller is not a stranger any more. Both devices carry
-- the same `auth.uid()`, so the ordinary owner-scoped policies in 0006 and 0010
-- already return the right rows on both, and every one of these functions is a
-- second way in that nothing uses.
--
-- A second way in that nothing uses is not neutral. Each of these is still a
-- live endpoint that trades a uuid for somebody's flight numbers, seat numbers
-- and booking references, reachable by any signed-in visitor -- which, with
-- anonymous sign ins on, is anyone who opens the deployed URL. Any code that
-- ever left the machine it was made on is still valid. There is no expiry and
-- nothing rotates them. Leaving these granted keeps that true forever.
--
-- ------------------------------------------------------------ what it costs
--
-- Sharing a trip with another person goes away with this, and it is worth being
-- honest that it was a real feature and not only a workaround. Handing someone
-- a uuid was the whole of it. Sharing now means handing them the account, which
-- is not the same thing and is worse for anyone who is not you.
--
-- That is a deliberate trade and not an oversight: what the codes bought in
-- reach they charged for in a permission that cannot be withdrawn. If sharing
-- with another person comes back it should come back as an invitation to a
-- trip, which is a row that names two accounts and can be deleted, rather than
-- a secret that cannot be unlearned.

-- ------------------------------------------------------------- revoked, not dropped
--
-- Revoking is what removes the permission; after this the functions exist and
-- nothing on the internet can call them. Dropping them would do that too and is
-- one line each, but it is not reversible in the way this is, and while the new
-- build is settling on real devices the ability to put a grant back in one
-- statement is worth more than the tidiness.

revoke all on function public.open_trip(uuid) from public, anon, authenticated;
revoke all on function public.save_trip(uuid, jsonb, integer, text, text) from public, anon, authenticated;
revoke all on function public.open_trip_expenses(uuid) from public, anon, authenticated;
revoke all on function public.save_trip_expenses(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.open_trip_checklist(uuid) from public, anon, authenticated;
revoke all on function public.save_trip_checklist(uuid, jsonb) from public, anon, authenticated;

-- The column stays. It is not what granted anything -- the grants above were --
-- and dropping it would throw away the only route back if any of this has to be
-- undone in a hurry. It costs one uuid per row and now means nothing.
comment on column public.itineraries.share_code is
  'Retired in 0012. Opened a trip from any browser until email sign in replaced it. Grants revoked; nothing reads this.';

-- ================================================================== checks

select * from (
  select 1 as ord, 'open_trip is closed' as check, '' as found,
    case when has_function_privilege('authenticated', 'public.open_trip(uuid)', 'EXECUTE')
         then 'STILL OPEN to every visitor' else 'ok' end as status

  union all
  select 2, 'save_trip is closed', '',
    case when has_function_privilege('authenticated', 'public.save_trip(uuid, jsonb, integer, text, text)', 'EXECUTE')
         then 'STILL OPEN to every visitor' else 'ok' end

  union all
  select 3, 'the expense functions are closed', '',
    case when has_function_privilege('authenticated', 'public.open_trip_expenses(uuid)', 'EXECUTE')
           or has_function_privilege('authenticated', 'public.save_trip_expenses(uuid, jsonb)', 'EXECUTE')
         then 'STILL OPEN to every visitor' else 'ok' end

  union all
  select 4, 'the checklist functions are closed', '',
    case when has_function_privilege('authenticated', 'public.open_trip_checklist(uuid)', 'EXECUTE')
           or has_function_privilege('authenticated', 'public.save_trip_checklist(uuid, jsonb)', 'EXECUTE')
         then 'STILL OPEN to every visitor' else 'ok' end

  union all
  -- The one that matters after all this: the ordinary path still works, because
  -- it is now the only path.
  select 5, 'owners can still reach their own trips', '',
    case when exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'itineraries'
                        and cmd = 'SELECT')
         then 'ok' else 'no select policy, nobody can read anything' end

  union all
  select 6, 'trips stored', (select count(*)::text from public.itineraries), 'ok'
) t order by ord;
