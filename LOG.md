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

## 2026-09-05 · A restore that cannot brick the app

**Commit:** see the commit titled "A restore that cannot brick the app"

A review of `f6086de` found six things. The first could have cost the trip the
feature exists to protect.

**A malformed backup was a one-way door.** `parseBackup` checked that `days` was
an array and nothing about what was in it, so `days: [1, 2, 3]` passed. Restore
wrote it to storage and reloaded, and `usage` in `store.ts` then walked
`day.items` on something that has none. There is no error boundary anywhere in
the app, so that is a blank page. A blank page has no Restore button on it, and
the bad data is already persisted, so every reload after that is blank too.

Verified by running it: `days: [1,2,3]` passed validation and then threw
`TypeError: day.items is not iterable`. The rule now is that anything the app
will later iterate has to be refused up front, and the message names the day.
Everything softer stays lenient, so a backup with no ledger still restores its
trip.

**A failed restore said "Nothing was changed" while having changed things.**
`writeBackup` was four separate `set` calls, each its own IndexedDB transaction.
A quota error on the second left the trip from the file beside the ledger from
before, and told the user nothing had happened. One `setMany` now, which is a
single transaction, so the message is true.

**The dialog could not tell you it was about to delete your ledger.** A file
carrying no expenses keeps what is here; a file carrying an empty list erases
it. Both rendered as the same sentence, because the count is 0 either way.
`summarise` gained `hasExpenses` and `hasPlaces`, and the dialog now says which
of the two is happening, in both directions, for the ledger and the places. It
also reads what is actually in this browser rather than counting only the days
it can see on screen.

**Two `TypeError`s inside the parser meant to prevent them.** `itinerary: null`
is not `undefined`, so the old check read `.days` off null; `days: [null]` threw
in `summarise` because the optional chain guarded `.length` rather than the day.

**The storage keys were five copies of four strings.** Renaming one in
`store.ts` would compile, ship, and quietly produce backups missing that
section, which is the worst shape of bug this feature could have: a backup that
looks fine and is not. They live in `storageKeys.ts` now, and a rename is a
compile error at every use.

**CI would have failed on every run.** `actions/checkout@v4` clones at depth 1,
so the base commit the retirement check diffs against is not in the object
database, and `git diff` against it aborts the step. `fetch-depth: 0` now, and
the guard tests reachability with `git cat-file -e` rather than only looking for
all zeros, which covers a force push too.

Also dropped: a re-parse in `onConfirm` whose failure branch was unreachable,
since the same text had already parsed to build the dialog.

**Verified:** 69 tests pass, nine of them new and all covering files that would
have got through before. Build passes, extract still byte-identical, typecheck
clean. Checked the CI grep still matches both real retirement migrations and not
`0001`.

**Careful of:** a second tab holding the old trip in memory will overwrite a
restore on its next edit. Not introduced here, but restore is the first action
that makes it destructive. `readBackup` and `writeBackup` still have no tests,
because they need a fake IndexedDB.

## 2026-09-05 · A backup that reads back, ids that survive two devices, and CI

**Commit:** see the commit titled "Save a copy that reads back, and a net to catch the rest"

The rest of stage 0. Four things, all groundwork for putting the trip in the
database, none of which changes how the app behaves for someone who never has a
problem.

**`newId` was unique within one tab and nowhere else.** A timestamp plus a
counter that resets to zero on every page load, so two browsers adding their
first day in the same millisecond minted the same id. Unreachable while a trip
lived in one browser; a silent merge collision the moment the same trip is open
in two. Now `crypto.randomUUID()`, with `getRandomValues` and then a timestamp
as fallbacks for a non-secure context. `expenses.ts` had its own copy of the
same counter and now shares this one.

**A backup that is actually a backup.** The HTML and text exports render a trip
for people to read; neither can be loaded back. `backup.ts` reads and writes
JSON that round trips, and **Save a copy** and **Restore a copy** sit next to
them in the export menu. It carries the ledger and the added places too, not
just the itinerary, because until the trip is on a server this file is the only
copy that survives the browser clearing its storage.

Restore is the one action in the app that overwrites a trip and is not covered
by undo, so it confirms with both sides named: what the file holds, when it was
saved, and what is about to be replaced. Parsing is strict about the envelope
and lenient about the contents, so a file from another app is refused outright
while a backup missing its expenses still restores the trip. It writes straight
to storage and reloads rather than going through the reducer, because a half
applied restore is worse than a reload.

**Vitest, and 60 tests.** No framework existed, and the reducer is pure and
exported and had never run outside a browser. `tsconfig.app.json` includes
`src`, so `tsc -b` typechecks the tests as part of the build with no config
change, and nothing reaches them from `index.html` so the bundle is unchanged at
411 kB. They pin the things the sync layer is about to collide with: that `load`
clears the undo stack, that a move pushes no undo point, that `moveItem` guards
an unknown id, that a row with no currency is yuan (declare that column
`default 'SGD'` and every legacy row silently becomes 5.45 times dearer), and
that a note never lands in the field two callers read as a name.

**CI, with the step that would have caught the drift.** Build, test, then
regenerate and `git diff --exit-code`. Building proves nothing about generated
files going out of step with their generator: the tree compiled fine for four
commits while `npm run extract` produced something that did not. Only
regenerating and diffing catches it. A fourth step fails a commit that adds a
migration deleting places without touching `seed.sql`, which is the shape of the
gap that left the live database 21 places short. `.gitattributes` pins LF so a
Windows checkout and CI agree.

**Verified:** ran all three CI gates locally. Build passes, 60 tests pass, and
the regenerated files still match byte for byte. Checked `git add --renormalize`
touches only the files this commit already changes, so `.gitattributes` brings
no mass rewrite. Confirmed the test files leave no trace in the bundle.

**Careful of:** restore reloads the page, so anything typed and not yet written
through is lost with it. Acceptable for a deliberate restore, and worth knowing.
The backup format is versioned and refuses a file from a newer version rather
than guessing, so raising `BACKUP_VERSION` is a promise to keep reading old
files.

## 2026-09-05 · Stop the "place is gone" note pretending to be a name

**Commit:** see the commit titled "Stop the 'place is gone' note pretending to be a name"

A review of `8d75e8b` and `e99b36b` found four things wrong, two of them
regressions I introduced.

**`itemTitle` returned a status phrase in a field that means "English name".**
Two of the four callers read `.en` as *the name of the thing*, so putting
"no longer in the library" there made them say it:

- `EditPage.tsx` `draggingTitle` returns `.en` alone, so dragging a stop whose
  place had gone showed a floating chip reading "no longer in the library". The
  recovered name in `.zh` was thrown away.
- `ItemRow.tsx` labels its edit and remove buttons `${title.en || title.zh}`,
  preferring `.en`, so a screen reader announced "Edit no longer in the
  library". With several retired stops, every button in the list got the same
  label.

`ItemTitle` is now a named type with a third field. `en` is the English name and
only ever that; `note` is why the stop has nothing behind it. The two callers
that want a name read `zh || en`, which also fixes a blank drag chip for custom
items that predates all of this. The four display sites render `note`
separately: italic under the row in the editor, parenthesised on the sheet and
in both exports.

**The README gave two reasons that were newly wrong**, which is worse than the
vague text it replaced.

- It said 0002 is needed because "0003 rebuilds those views, and cannot do it
  before they exist". Not so: 0003 opens with `drop view if exists` and rebuilds
  with `create or replace view`, which is happy to create one. 0003 needs 0002
  because the view bodies it writes select from `place_reviews` and
  `districts.sort_order`, and 0002 is what adds both.
- It said 0004 and 0005 go after the seed "because they delete what it must not
  re-create". All 24 slugs they delete appear zero times in the current seed, so
  on a fresh project they are no-ops wherever they run. `LOG.md` already said
  this, so the README was contradicting the log. The ordering still matters on a
  database seeded by an older extractor, which is what it now says.

**`0001_catalog.sql` recommended a tool that gets the order wrong.** Its header
offered `supabase db push`, which applies migrations in numeric order, putting
0004 and 0005 before the seed, and never runs the seed at all.

**Verified:** `npm run build` passes. Read all four `itemTitle` call sites plus
both aria-labels and the drag overlay, and confirmed none now reads a note as a
name. Re-checked the migration claims against the files rather than the comments.

**Careful of:** nine of the sixteen slugs 0005 retires are `place-3` through
`place-11`, which read back as "Place 3" and so on. That is a plausible-looking
fake name rather than a recovered one, and the note beside it is what stops it
being misleading. Also unfixed: a stop pointing at a place added while signed in
reads as gone, because the place is stored under a slug while the item still
points at its `user:` id. That is the identity mismatch already in the follow-ups.

## 2026-09-05 · Close what the review of the storage fix found

**Commit:** see the commit titled "Close what the review of the storage fix found"

A review of `e0e5f6f` found the guard itself correct in all three write effects,
and four things around it that were not.

**The banner covered the toolbars, and that was mine.** `.storage-warning` went
in at `z-index: 60`, above every sticky nav (10 to 20), the library sheet
(39 to 40) and every dialog (50), with no `pointer-events` rule. So in the state
it exists to report, it sat on top of whichever nav was sticky and made those
buttons unclickable, Undo included, which is the control someone reaches for
when the app is misbehaving. It also floated over open dialogs.

Now `z-index: 45`, above the navs and the library, below every dialog, and
`pointer-events: none` so it can never take a click. It still overlaps a sticky
nav visually on a narrow screen. Fixing that properly means the banner taking
flow space, and the pages are `min-height: 100%` with the body scrolling, so
that is an app shell restructure. Not worth it for a state where nothing saves
anyway; a click that goes nowhere was.

**"Present but unreadable" was still being rounded down to "absent".** The fix
hardened the read that *throws*. It did not harden the read that *returns
something unexpected*, which lands in the same empty state and reaches the same
`set()`. Three places:

- `expenses.ts` took `Array.isArray(stored)` as the test, so a stored value that
  is not an array left the list empty, `storage` went `'ready'`, and `[]` was
  written over it on the next commit. Automatic, no click needed. It is now
  `'failed'`.
- `store.ts` treated a stored object without `days` as a first visit and offered
  the opening choice, so one click saved a blank trip over it. Now `'failed'`.
- `userPlaces.ts` had the whole original defect untouched: it caught a failed
  read and returned `[]`. The next add or remove then wrote a one item list over
  places that were on disk and merely unreadable. It returns `null` for a failed
  read now, and `CatalogContext` refuses both writes while that is true.

**The expenses page asserted an empty ledger it had not read.** `useExpenses`
returned `storage` and nobody read it, so a failed read rendered "Nothing
recorded yet. Add a flight, a hotel night or a bowl of noodles above and it
lands here" over a ledger whose contents are exactly what is unknown. It now
says it could not read them.

**Verified:** `npm run build` passes. Grepped every `setStorage` and every
`storage` guard across the four modules and read them together, to confirm one
rule holds everywhere: write only on `'ready'`, and anything not recognised is
`'failed'` rather than empty.

**Careful of:** a write that fails after a successful read still leaves
`storage` at `'ready'` and shows no banner. Quota exceeded, or storage revoked
mid-session, looks like a working app. Probably more common in practice than a
read that throws, and not yet handled.

## 2026-09-05 · Write down the setup order, which two files had wrong

**Commit:** see the commit titled "Write down the setup order, which two files had wrong"

The real chain is `0001 → 0002 → 0003 → seed.sql → 0004 → 0005`, and it is not
the order the files are numbered in, because the seed writes the column shape
0003 leaves behind.

Two files said otherwise. `0002_reviews.sql:2` said "run this after
0001_catalog.sql and seed.sql", an order that cannot work. `README.md` listed
two steps, 0001 then the seed, and never mentioned 0002 through 0005 at all.
Following the README on a fresh project runs the seed against a pre-0003 schema
where `address` and `country` do not exist and `tags` is still an array. The seed
is one transaction, so nothing lands, not even the districts, and the error names
a column rather than a migration.

0003, 0004 and 0005 already said the right thing in their own headers, so only
those two needed correcting.

The README now also states the *recurring* order, which nothing did: after
editing the guides it is `npm run extract` **and then** re-run `seed.sql`. And it
warns that `check.sql` needs 0002 and 0003 before it can run, so on exactly the
half migrated database the old README produced it reports a missing column
instead of naming the migration to run. That one is still open.

`npm run extract` now ends with the same reminder. It has just rewritten
`seed.sql` and the database has not heard about it, which is silent: the site
keeps serving the previous catalog with no error anywhere. That gap left the live
database 21 places short until it was counted, so the script says it every run
rather than trusting anyone to remember.

**Verified:** `npm run extract` still produces byte-identical generated files, so
the reminder is the only change in behaviour. `npm run build` passes. Grepped the
rest of `supabase/` for other order claims and found none stale.

**Careful of:** this is documentation, so nothing enforces it. A CI step that
regenerates and diffs would catch the extract half; nothing can catch the seed
half except running `check.sql`.

## 2026-09-05 · Name a stop whose place has left the catalog

**Commit:** see the commit titled "Name a stop whose place has left the catalog"

`itemTitle` returned `{ zh: customTitle ?? '', en: '' }` when a stop's `placeId`
did not resolve. A catalog stop has no `customTitle`, so it rendered as a time
with nothing beside it, in all four places that call it: the row in the editor,
the sheet, the HTML export and the pasted text.

Not hypothetical. `0004` deletes eight slugs and `0005` deletes sixteen more, so
any trip saved before those migrations and opened after them shows blank rows
today. Reads as a broken sheet rather than as a place that went away.

Slugs are generated from the English name, so reading one back recovers most of
it. The eight `0004` removed now render as "West Lake", "Lingyin Temple",
"Disneyland" and so on, with "no longer in the library" as the secondary line.
A place added in this browser carries an opaque id instead of a name, so that
case says "Added place" rather than printing gibberish.

**Verified:** ran the slug reader over all eight retired slugs and checked the
output by eye. `npm run build` passes. The fix is in `catalog.ts` rather than at
the four call sites, so the editor, the sheet and both exports pick it up
together.

**Careful of:** this makes a lost place legible, it does not reconnect it. The
stop keeps its time, note and cost, which is right, but the link to the catalog
is gone for good. Deleting a place in the app will detach its stops explicitly
rather than relying on this.

## 2026-09-05 · Stop a failed storage read from erasing the stored trip

**Commit:** `e0e5f6f`

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
