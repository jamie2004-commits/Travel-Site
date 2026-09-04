# Work log

What was done, when, and why. Newest first.

This is the record git history cannot give you on its own: the reasoning behind
a change, what was ruled out, how it was checked, and what was left open. Git
says what changed. This says why it was worth changing, and what to be careful
of next time.

Written by agents via the `/log` skill, and by hand whenever that is easier.
One entry per meaningful piece of work. Not every commit earns one: a typo fix
does not, a decision does.

---

## 2026-09-05 · Stop a failed storage read from erasing the stored trip

**Commit:** `c067250`

`useItinerary` tracked the load with one boolean, and set it true on both
branches: `.then` when the read returned, and `.catch` when it threw
(`store.ts:198`). A read that threw therefore left `loaded` true, `needsStart`
false, and the reducer holding `emptyItinerary()`. The write-through directly
below then fired and saved that empty trip over whatever was on disk.

The comment above that effect says it exists so "the first render never clobbers
what is on disk". It was right about the empty case and wrong about the error
case, which is the one where there is something to clobber.

A boolean cannot tell those apart, so it becomes `StorageState`:
`'loading' | 'ready' | 'failed'`. Writes require `'ready'`. A failed read now
loses this session's edits, which is the smaller of the two losses and the only
one the user can be told about. `expenses.ts` had the identical shape and gets
the identical fix.

Two things that were silent are no longer. Both `.catch` handlers log rather
than swallowing, and a failed read puts a fixed banner across the top of the app
saying nothing is being saved. It cannot be dismissed: every edit made under it
is going to be lost, and a notice that can be waved away is one that gets waved
away.

`loaded` is still returned, derived as `storage !== 'loading'`, so `App.tsx:38`
is unchanged and a browser that cannot read its storage still gets a working
app. It just does not get a saved one.

**Verified:** `npm run build` passes (tsc and vite). Read back both write-through
effects to confirm the guard is `storage !== 'ready'` and not a negation of
`'loading'`, which would have preserved the bug.

**Careful of:** this is a fix for losing an existing trip, not for losing new
work. When storage is unreadable the app now deliberately saves nothing at all.
That is the intended trade, and the banner is what makes it honest.

## 2026-09-05 · Re-seed the live catalog, which was 21 Hangzhou places short

**Commit:** none. This was a change to the live Supabase project
(`yptaydsbufgkktxgljsf`), not to the repo.

The deployed site was serving 115 places against the 136 `seed.sql` writes.
Every missing row was Hangzhou: Shanghai was exactly right at 74, districts
right at 16, and there were **zero** unexpected rows, so the database held a
clean subset of the seed rather than anything corrupted or stale.

The cause was an order-of-operations gap, not a bad file. Migrations 0001
through 0005 had all been applied, including the two that *delete*: 0004 removed
the eight rows an older extraction had renamed, and 0005 removed the Hangzhou
karting venues, the duplicate escape rooms and the `place-N` slugs. But
`seed.sql` was never re-run afterwards, so the 21 replacement rows it writes
were never inserted. The deletions landed and the additions did not.

Fixed by re-running `supabase/seed.sql`. Nothing else was needed: the current
seed writes none of the slugs 0004 and 0005 delete, so re-running it cannot
resurrect them, and 0004/0005 did not need re-running.

Checked first that this was safe, because the seed upserts on slug and could in
principle overwrite hand-added rows: 0 places with `source = 'user'`, 0 rows in
`place_reviews`, and the schema already post-0003 (`address` renamed, `country`
and `tags_array` present), which is the shape the seed's column list expects.

**Verified:** over the REST API as the `anon` role, before and after. Counts now
136 total / 74 Shanghai / 62 Hangzhou / food 65 / sight 25 / activity 44 /
shopping 2, every one matching the seed. Slug-level set comparison against
`seed.sql` is an exact match: nothing missing, nothing extra, all 21
previously-absent rows present. No retired slug came back. Every place resolves
to a real district. Spot-checked three of the new rows end to end and they carry
real names, prices, durations and a correctly generated `tags_array`.

**Careful of:** this will happen again on every catalog change. Editing the
guides means `npm run extract` **and** re-running `seed.sql`, and if the change
retires anything, a new migration too. The counts in `check.sql` are the cheap
way to notice; they were right all along and would have caught this.

## 2026-09-05 · Take the Vercel deployment out from behind the login wall

**Commit:** none. Vercel project setting.

Every URL for the project answered `302` to `vercel.com/sso-api`, including the
production alias. Vercel enables Deployment Protection by default on new
projects, and its Standard Protection scope covers everything except a
production *custom domain*. A generated `*.vercel.app` URL is not that, and this
project has no custom domain, so there was no public entry point at all.

Turned off in Settings, Deployment Protection, Vercel Authentication. The site
now answers 200 on `travel-site-xi-eight.vercel.app`, the production alias and
the older deployment URL, all serving the same build.

**Verified:** the deployed bundle is 627KB against 405KB for a local build with
no environment variables, and contains the Supabase runtime strings (`gotrue`,
`postgrest`, `X-Client-Info`). So `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` really were set in Vercel at build time, which is the
only time they can be set: they are inlined at build, and setting them on the
server afterwards does nothing. The embedded JWT decodes to `"role":"anon"`,
not `service_role`.

**Careful of:** disabling protection unprotects every past deployment, not just
the current one. And the anon key is now genuinely public, so RLS is the only
thing guarding the catalog. It is configured correctly, but that is now
load-bearing rather than theoretical. Separately, the emailed sign-in link
returns to `window.location.origin`, so the deployed origin has to be in
Supabase's Authentication, URL Configuration, Redirect URLs or production
sign-in breaks the way it broke locally on port 5173.

## 2026-09-05 · Stop the extractor putting lengths back on itinerary stops

**Commit:** `b8df87e`

`npm run extract` had not produced a compiling file since `4d059f2` ("A stop is
a start time, not a span"). That commit removed `durationMinutes` from
`ItineraryItem` and updated the nine files that read it, including the
*generated* `src/data/starterItinerary.ts` — which it edited **by hand**.
`scripts/extract.mjs`, which writes that file, was never touched.

The result was a tree that is consistent as committed and breaks the moment
anyone regenerates: 38 `TS2353` errors in a file whose own header says not to
edit it by hand. Three later commits (`efabe03`, `649e8b9`, `aa8da03`) hit this
and worked around it, shipping a regenerated `places.ts` and `seed.sql` while
quietly dropping `starterItinerary.ts` from the commit each time.

Two sources of the field, both removed from the generator:

- the item literal copied the *catalog's* duration onto the *stop* — the exact
  conflation `4d059f2` set out to end. 4 of the 38.
- a loop inferred a length from the gap to the next start time, capped at four
  hours. The other 34. These were never in the source data: "Head down to the
  venue" got 88 minutes, "Couple walks in" got 2 — subtraction between adjacent
  rows, presented as fact.

`toMinutes` went with them (the loop was its only caller). `parseDuration`
stays: `Place.durationMinutes` is still real, still read by `PlaceCard` and
`ActivitiesPage`, still written to `seed.sql`.

**Verified:** regenerated all four outputs; every one byte-identical to what is
committed. That proves the hand edit was the *only* manual divergence. `npm run
build` passes.

**Also:** removed the doc comment `4d059f2` orphaned in `src/lib/format.ts`,
which described a deleted `DEFAULT_DURATION` table and had come to sit above
`CostSum`, describing something else entirely.

**Careful of:** the repo has `core.autocrlf=true` and no `.gitattributes`, while
the extractor writes LF. A real `npm run extract` rewrites every line ending in
the working tree. `git diff` normalises it away, but `git status` will show the
generated files as modified with an empty diff. That is line endings, not
content.

---

## 2026-09-05 · Consolidate every branch into main

**Commits:** `b18707c`, `8b363d0` (merges)

Seven branches besides `main`. Five were already fully merged. Two carried work
that had never landed:

- `claude/hangzhou-activities-count-yuftkf` (2 commits) — the Hangzhou fun guide
  swap: six karting venues and four near-identical escape rooms out, nine rated
  classics in, under two new activity groups. Plus `supabase/audit.sql` and
  migration `0005_retire_hangzhou_karting.sql`, and six `place-N` slugs given
  real names.
- `claude/manual-activity-creation-cqh94j` (1 commit) — dev server pinned to port
  3000 with `strictPort`, so the emailed Supabase sign-in link stops landing on
  `ERR_CONNECTION_REFUSED`.

Both merged with no conflicts. Build verified before and after. All seven
branches then deleted from `origin`; `main` is the only ref that remains.

**Careful of:** `gh` is not installed on this machine, so open PRs could not be
checked before deleting. GitHub auto-closes a PR when its branch is deleted.

---

## Open follow-ups

Found while auditing, not yet fixed. Roughly worst first.

**Setup order is documented wrongly, in two places.** The real chain is
`0001 → 0002 → 0003 → seed.sql → 0004 → 0005`. But `0002_reviews.sql` says to run
it "after 0001 and seed.sql", which is impossible, and `README.md` lists only
0001 then seed.sql, never mentioning 0002–0005. Following the README verbatim on
a fresh project runs `seed.sql` against a pre-0003 schema, where `address` and
`country` do not exist and `tags` is still `text[]`. The seed is wrapped in a
transaction, so **nothing lands at all** — not even the districts. 0002 is a hard
prerequisite of 0003 even though the app never reads anything 0002 creates,
because 0003 rebuilds its views against `place_reviews` and `districts.sort_order`.

The docs are also silent on the step that actually bit us: a retirement
migration has to be followed by re-running `seed.sql`, or the deletions land
without the replacements. That is what left the live catalog 21 rows short. Any
fix to the setup docs should state the recurring order too, not just the
first-time one.

**`check.sql` cannot diagnose the failure it exists for.** A `UNION ALL` is
planned as one statement, so its unguarded references to `place_reviews` and
`places.country` error out on exactly the half-migrated database the README
leads you to build — defeating the guarded branches that would have printed
"missing, run migrations/0002" and "run migrations/0003". `audit.sql` touches
only 0001 columns and works at any schema version.

**The starter itinerary silently renders no flights and no hotels.**
`source/itinerary.html` carries a `STAYS` map (a hotel per night) and `FIXED`
rows with flight legs (`type`, `f:{from,to,dep,arr}`). The extractor reads
neither: `readPlannerItinerary` takes only `time`, `ref`, `cn` and `note`, and
builds a day with no `stay`. The app has a full editor and renderer for both
(`stay.ts`, `travel.ts`, `DayCard`, `ItemRow`, `ItineraryView`), all conditional,
so the sample trip just shows nothing with no error. `README.md` justifies
skipping hotels because they "carry booking and payment wording" — that predates
the `Stay` type and only really covers the booking note.

**A place added to Supabase can never be removed in the app.** `isUserPlace`
tests a `user:` prefix, but a Supabase-stored place comes back keyed by slug, so
no remove control renders — even though the delete grant and policy both exist.

**Seed re-runs can overwrite user rows.** The seed upserts `on conflict (slug)
do update set ... source = excluded.source`. A user-added place whose slug
collides with a catalog slug is silently replaced, and `source` flips from
`'user'` to a guide filename — which also loses the `source <> 'user'` guard that
0004 and 0005 depend on. Separately, a user row matching a seed row's *natural*
key under a *different* slug aborts the whole seed transaction on
`places_natural_key`.

**Two divergent slug algorithms.** `extract.mjs` strips to `[a-z0-9]`;
`placeWrites.ts` uses `\p{Letter}\p{Number}`, which keeps CJK — so a Chinese-only
name yields a slug like `萝春阁` rather than the empty string its fallback
anticipates.

**Unfriendly Postgres errors reach the user.** `AddPlaceDialog` allows
`duration_minutes = 0` (the check demands `> 0`) and does not validate
`priceMin <= priceMax`. Both surface as raw constraint-violation text, since
`describeFailure` has no case for `23514`.

**The type layer still hardcodes the two-city world 0003 dismantled.** 0003
dropped the `city in ('shanghai','hangzhou')` check specifically so a third city
would not need a migration, and made `name_zh` nullable for places outside the
Sinosphere. But `City` is still a two-value union that the read path casts into
blindly, `AddPlaceDialog` hardcodes two buttons, and `catalogSource` selects
`country` and then never uses it. Likewise 0003 renamed `address_zh` → `address`
because "the name was a lie waiting to happen", yet `types.ts` still says
`addressZh`, translated on both sides.

**Stale docs.** `README.md` opens with "no accounts, no server, no database"
against five migrations and working magic-link auth; says added places are "not
written to Supabase… there is no sign in yet" (they are, when signed in, and
`AddPlaceDialog` repeats the claim on screen); says extract writes three files
and omits `seed.sql`; and its tree lists `src/lib/places.ts` and
`components/ItineraryPane.tsx`, neither of which exists. `README.md` and
`extract.mjs` both say "four guide files" when there are six. The food guide holds
53 places, not the 47 / "roughly 46" claimed in `README.md`, `BRIEF.md` and
`extract.mjs`. `BRIEF.md` still carries the pre-drift `ItineraryItem` with
`durationMinutes`.

**No guard against this class of bug.** Nothing runs the extractor and fails on a
diff, there is no lint config, and `tsconfig.app.json` includes `src` only — so
`scripts/` is never typechecked. A CI step that regenerates and diffs would have
caught the `durationMinutes` drift three commits earlier.
