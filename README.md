# 行程编排 Itinerary Builder

Four pages over one Shanghai and Hangzhou trip. The trip is kept in this browser
and on a Postgres database behind Supabase, so it survives clearing the browser
and opens on another machine. Every browser takes an anonymous identity on first
load, which is who a trip belongs to until an email is put on it; signing in with
that address on a second device makes both devices one person, and the same trips
are listed on each.

**The sheet** (`#/`) is what the app opens on and what you read on the trip: a
typeset itinerary with a timeline per day and a budget table, in the visual
language of the hand written itinerary page. It renders whatever is stored, and
prints cleanly.

**The editor** (`#/edit`) is where you change it: the place library on the left,
the itinerary on the right, and a day rail across the top that decides which day
everything adds to. `#/build` was its old address and still lands here.

**Things to do** (`#/activities`) is the library as a full page, with a day
picker on it, so browsing a place and adding it to a day are the same act.

**Expenses** (`#/expenses`) is what the trip actually cost. Kept as rows rather
than as part of the trip document, so two devices can each add a receipt without
one overwriting the other.

All four read the same stored trip, so an edit in one shows up in the others. The
route lives in the hash, so a link to any page survives a reload.

## Running it

```
npm install
npm run dev      # http://localhost:3000
npm run build    # typecheck and bundle into dist/
npm run extract  # regenerate src/data/ from source/
```

## Where the data comes from

`source/` holds the six files the data was migrated from, five guides and the
planner:

| File | What it contributes |
| --- | --- |
| `shanghai-hangzhou-food-guide.html` | 53 food places across 7 Shanghai and 5 Hangzhou districts |
| `classic-shanghai-guide.html` | Shanghai sights, nightlife and food experiences |
| `shanghai-fun-guide.html` | escape rooms, karting and other activities |
| `classic-hangzhou-guide.html` | Hangzhou sights, food and day trips |
| `hangzhou-fun-guide.html` | Hangzhou escape rooms, karting and other activities |
| `itinerary.html` | the 8 day starter trip, and the non food places it visits |

`scripts/extract.mjs` parses them and writes `src/data/places.ts`,
`src/data/districts.ts`, `src/data/starterItinerary.ts` and
`supabase/seed.sql`. All four are generated: edit the script, not the output.
CI regenerates them and fails on a diff, so the output cannot drift from the
script again.

Nothing in the data is hand written. Every name, description, tag, price,
address and metro line is read out of the HTML. What the script does decide is
classification: whether a card is a sight or an activity, and which district a
place sits in, matched on phrases that appear literally in the sources. A place
the sources do not locate goes into a per city `其他 Elsewhere` bucket rather
than being guessed at.

`npm run extract` prints a report of everything incomplete: places with no
Chinese name in the source, prices that read "Varies" rather than a number,
districts it could not resolve, and Chinese names mentioned in a note that never
became a place of their own.

The nightly hotel blocks in `itinerary.html` are deliberately not extracted,
since they carry booking and payment wording. No names or booking references
appear in the generated data.

## Shape of it

```
src/
  types.ts              the Place, District, ItineraryItem, Day, Itinerary types
  data/                 generated, see above
  lib/
    store.ts            reducer, undo stack, IndexedDB persistence
    route.ts            which of the four pages is showing
    supabase.ts         the client, or null when the two variables are unset
    identity.ts         the anonymous identity every browser takes on first load
    catalog.ts          the browsable place list, however it was loaded
    catalogSource.ts    loads it from Postgres, falling back to the bundled copy
    tripSync.ts         keeps the trip in step with the server, and asks on a clash
    syncMeta.ts         what this browser last agreed with the server
    cloudTrip.ts        trip and ledger reads and writes, and the trip list
    account.ts          putting an email on this browser's identity
    openTrip.ts         which of the account's trips this device is editing
    switchTrip.ts       moving this device onto another trip, all five parts of it
    mergeRows.ts        three-way merge for the ledger and the lists
    pushedRows.ts       what this device last agreed with the server, per list
    tripLabels.ts       naming a trip so it can be picked out of a list
    expenses.ts         the ledger, its currencies and its totals
    placeWrites.ts      adding and deleting catalog places
    userPlaces.ts       which places this browser is allowed to edit
    backup.ts           save and restore a copy as a file
    schedule.ts         day windows and clashing times
    days.ts             day numbering, including a departure eve as Day 0
    stay.ts             hotel blocks across nights
    travel.ts           flight and train legs
    format.ts           price, duration and cost sum formatting
    export.ts           HTML and plain text export
  components/
    ItineraryView.tsx   the sheet: hero, day timelines, budget table
    EditPage.tsx        the editor: day rail, library, itinerary
    ActivitiesPage.tsx  the library as a page, with a day picker
    ExpensesPage.tsx    the ledger
    StartDialog.tsx     first visit: sample, blank, or open a trip you have
    LibraryPane.tsx     filters and results
    AddPlaceDialog.tsx  add a place to the catalog
    DayCard.tsx         one day: droppable, sortable, custom item field
    ItemRow.tsx         one item, with its inline edit panel
    SyncBar.tsx         what sync is doing, and the prompt when it needs an answer
  sheet.css             the itinerary sheet, scoped so it never reaches the editor
```

State is written to IndexedDB through `idb-keyval` on every change, but only
after the stored copy has been read, so a first render never clobbers what is on
disk. Removing an item, removing a day and reset each push an undo point first.

## The catalog: bundled, or Supabase

The browsable library of places can come from either place, and the app decides
at startup.

**Bundled (the default).** Nothing to configure. The catalog compiled into
`src/data/` is used, the app works offline, and the Supabase client is
tree-shaken out of the bundle entirely.

**Supabase.** Set both variables in `.env.local` (see `.env.example`) and the
catalog is read from Postgres instead:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

These are read at **build** time, not run time. Setting them on the server after
`npm run build` does nothing; set them wherever the build happens.

Setting up the database. **The order matters and is not the order the files are
numbered in**, because the seed writes the shape migration 0003 leaves behind:

1. `supabase/migrations/0001_catalog.sql` — the tables.
2. `supabase/migrations/0002_reviews.sql` — reviews, and the two rollup views.
   Required even though nothing in the app reads a review yet: the views 0003
   rebuilds select from `place_reviews` and `districts.sort_order`, and 0002 is
   what adds both.
3. `supabase/migrations/0003_places_extensible.sql` — renames `address_zh` to
   `address`, adds `country`, and turns `tags` into a comma separated string
   with a generated array beside it.
4. `supabase/seed.sql`, which `npm run extract` generates alongside the
   TypeScript. It is idempotent and keyed on the slug, so re-running it after a
   source correction updates rows in place and every place keeps its uuid.
5. `supabase/migrations/0004_retire_superseded_places.sql` and
   `0005_retire_hangzhou_karting.sql` — remove rows an older extraction left
   behind. On a fresh project these do nothing, because the current seed writes
   none of the 24 slugs they delete. They matter on a database seeded by an
   older extractor, and there they belong after the seed, so that the seed
   cannot put back what they have just removed.
6. `supabase/migrations/0006_itinerary.sql` — the trip, the ledger and the
   per person settings. Nothing here is readable without a session.
7. `supabase/migrations/0007_open_catalog.sql` — bounds what a visitor may add
   to the catalog, and makes the two rollup views run as the caller rather than
   as their owner, which is what stops them handing out rows row level security
   would otherwise withhold.
8. `supabase/migrations/0008_trip_codes.sql` — gives every trip a random code
   and four `security definer` functions that read and write a trip, and its
   ledger, by that code. This is what lets a trip open on a second machine
   without a sign in.
9. `supabase/migrations/0009_delete_catalog_places.sql` — lets a visitor delete
   a seeded place, which 0001 and 0007 both deliberately made impossible. Read
   its header before running it: with anonymous sign ins on, `authenticated`
   means anybody with the URL, so this hands every visitor a delete on the
   shared catalog. Skip it and the app still works; the remove button then
   refuses on seeded places and says why. Re-running 0001 or 0007 undoes it,
   because both recreate the delete policy.

10. `supabase/migrations/0010_checklist.sql` — the packing list and the run up
   to leaving, as rows beside the trip, plus the two `security definer`
   functions that read and write them by a trip code the way 0008 does for the
   ledger. Optional: skip it and the lists still work, they just stay in one
   browser and are carried only by Save a copy.

11. `supabase/migrations/0011_accounts_and_trips.sql` — drops the
   one-active-trip-per-owner index, so an account can hold several trips and two
   devices can sit on different ones. **Run this before deploying the build that
   goes with it.**

12. `supabase/migrations/0012_retire_trip_codes.sql` — revokes the six
   `security definer` functions that traded a uuid for a trip. **Run this only
   after that build is deployed and every device has loaded it**: a device still
   running the old bundle writes through `save_trip`, and those writes start
   failing the moment this lands. Nothing is lost — the old client keeps its
   edits locally and says so — but nothing reaches the server until it reloads.

6, 7, 8, 9, 10, 11 and 12 each end with a block of checks. Every row should say
`ok`.

Then, in the dashboard: **Authentication → Sign In / Providers → Anonymous
Sign-Ins → enable**. Every browser then quietly holds a real account, which is
what `auth.uid()` needs and therefore what every policy above is written
against. Anonymous sign-ins stay on: they are what a first visit gets, before
anyone has typed an address.

### Email sign in

Three settings, and the third is the one that looks optional and is not.

**Authentication → Sign In / Providers → Email → enable**, with **Confirm email**
on. Putting an email on an anonymous identity upgrades that same `auth.users`
row, so a trip made before signing in stays owned and nothing has to move.

**Authentication → URL Configuration → Site URL**, set to where the app is
actually served. It defaults to `http://localhost:3000`, which is why the dev
server pins that port.

**Authentication → Emails → Templates**, and this is the step that silently
breaks everything. The app asks for a six digit code, and Supabase's stock
templates send a *link* and no code, so the box has nothing to type into and the
link lands on an error. `{{ .Token }}` is what puts the code in the email:

> `{{ .Token }}` — Contains a 6-digit One-Time-Password (OTP) that can be used
> instead of the `{{ .ConfirmationURL }}`.

Two templates need it, one per flow, and editing only the first leaves the other
half broken:

- **Magic Link** — used by `signInWithOtp`, which is *I already have an account*
- **Change email address** — used by `updateUser({ email })`, which is
  *Set up an account with the trips on this device*

Both can be as small as:

```html
<h2>Your sign in code</h2>
<p>Enter this in the app:</p>
<p style="font-size:28px;letter-spacing:4px"><b>{{ .Token }}</b></p>
```

Codes rather than links is a deliberate choice, not only a reaction to this.
A link has to be opened on the device that is signing in, and the ordinary case
here is reading the email on a laptop while signing in on a phone. Supabase's own
docs also note that a scanner which prefetches the link consumes it, so the
person clicking it gets "Token has expired or is invalid", and they recommend
`{{ .Token }}` as the fix for that too.

Run the seed before 0003 and the first places insert fails: `address` and
`country` do not exist yet and `tags` is still an array. It is wrapped in a
transaction, so it aborts there and nothing lands at all, not even the
districts.

**After any change to the guides in `source/`**, the order is `npm run extract`,
then re-run `supabase/seed.sql`. Skipping the second leaves the database on the
old catalog with no error anywhere, and if the change retired a place, a new
migration is needed too.

To check a project is set up, run `supabase/check.sql` in the SQL editor. It
reports row counts, whether row level security is on, and whether anything has
left the catalog writable by anonymous visitors. Note it needs 0002 and 0003 to
have run: it reads `place_reviews` and `places.country` without guarding them,
so on a half migrated database it reports a missing column rather than telling
you which migration to run. `supabase/audit.sql` touches only 0001 columns and
works at any point.

`places.id` is a uuid and `places.slug` is the stable human key. The app uses
the slug, so a saved itinerary keeps working whichever source it loaded from.

If Supabase is configured but does not answer within six seconds, the bundled
catalog is used and the library says so rather than sitting on a spinner. The
catalog is 136 rows, so it is fetched once and filtered in the browser:
search stays instant and the library survives losing the connection.

### Adding places

The **添加地点 Add a place** button in the library takes a new place and writes it
to the catalog in Postgres, so it is there for every browser, not just this one.
The section dropdown files it under an existing heading or makes a new one. Added
places behave like any other place: filter, search, drag into a day, export.

The row is stamped with the anonymous identity of the browser that added it, and
only that browser can edit or delete it. `source` is pinned to `'user'` on both
insert and update, so an added place cannot be made to look seeded, and one
identity can hold at most 200 places. Seeded rows have no author at all, which is
what keeps the built-in catalog from being editable by anyone.

This is an open write endpoint on the public internet: the anon key ships inside
the bundle, so anyone who loads the page can add a place. That is the deliberate
choice for this deployment, taken instead of putting a sign in in front of it.
The per identity cap and the source pin are what bound the damage. A public site
would want auth here rather than these policies.

Where Supabase is not configured, an added place is kept in this browser only,
and the library says so.

## The trip: this browser, and the database

The trip is one JSON document in `itineraries`, one row per trip, alongside a
copy in this browser's IndexedDB. The browser copy is what the app renders, so
it works with the network down; the row is what makes the trip survive clearing
the browser and open somewhere else.

Saves are debounced 2.5 seconds, and forced through after 10 seconds of
continuous typing so a long edit is never held indefinitely. The ledger is
separate and slower at 4 seconds, because a row is typed in bursts and each save
reconciles the whole ledger.

**Nothing is saved until the stored copy has been read.** On a first visit the
store reports "ready" and "needs a start" in the same instant, so the gate is
both: without the second half a new browser would push its empty trip over a
real one, and the compare and swap would accept it, because nothing about it
looks like a conflict.

### Why a version and not a timestamp

Every write is a compare and swap. The client sends the version it last agreed
with, and the update only lands `where version = expected`. Two devices editing
the same trip cannot silently overwrite each other: the second one back is
refused and asked. Timestamps were the alternative and lost, because they are
the client's clock and a device an hour out would win every race it should lose.

`syncMeta` records what this browser last agreed with the server: the version
and the document. Without it a device that has been closed for a week cannot
tell "I changed nothing, the server moved on" from "we have both changed", and
the honest answer to those two is different. The first fast forwards silently.
The second is the only case that interrupts and asks.

Documents are compared with a canonical stringify, not `JSON.stringify`.
Postgres `jsonb` does not preserve key order, so a document that made the round
trip comes back reordered and a plain string comparison never matches, which
would make every idle page look like it had unsaved changes forever.

### Opening a trip somewhere else

Sign in with the same email on both devices. `itineraries` is scoped by row level
security to `owner_id = auth.uid()`, so once two browsers carry the same id, the
ordinary select returns the same trips on each and nothing special is needed to
bridge them.

The order matters on the first go. On the device that **has** the trips, use
*Set up an account with the trips on this device*: that calls `updateUser({email})`,
which upgrades the anonymous identity in place and keeps the same user id, so
every trip, expense and checklist row stays exactly where it is. On every device
after that, use *I already have an account*, which signs in and abandons that
browser's own anonymous identity along with anything it alone owned. Doing them
the wrong way round strands the trips under an identity nothing can sign in as.

Which trip a device is editing is that device's business, held in
`itinerary-builder/open-trip/v1` and never on the server. That is deliberate: one
active trip per *account* would mean the laptop and the phone must have the same
trip open, and switching on one would switch it under the other mid-edit. 0011
dropped the index that enforced it. A device with no pointer and exactly one trip
on the account adopts it, which is how existing installs upgrade without noticing;
with several, it asks rather than guessing.

**Trips** on the sheet, or *Your trips and account* in the editor, lists them,
switches between them, starts another and deletes one.

#### What replaced the trip codes

Until 0012 a trip was reachable by a random uuid on the row, and six
`security definer` functions traded that uuid for the trip, its ledger and its
lists. It was the only way to reach a second device without a sign in, and the
cost was a permission that could not be withdrawn: anyone who ever saw a code
could read and edit that trip forever, and nothing rotated or expired them.

Sharing a trip with another *person* went away with the codes, and that was a
real feature, not only a workaround. If it comes back it should come back as an
invitation — a row naming two accounts, which can be deleted — rather than a
secret that cannot be unlearned. `share_code` is still on the table, unread, so
there is a way back in a hurry.

### The ledger and the lists

Both are rows rather than documents, so neither has a version or a compare and
swap: two devices adding two different receipts should keep both, which a whole
document swap cannot express.

Each pushes a full reconcile — "these are all the rows there are, delete anything
else" — and each now **reads on load** before it is allowed to push. It did not
always. Reading only when a trip was first opened meant a device that had been
away was holding a stale list, and its next push deleted every row added anywhere
else; because both hooks mount app-wide, merely opening the app was enough to
fire it.

Reading is only safe if the read is merged rather than obeyed, and merging needs
three copies, not two: what is here, what is on the server, and what this device
last agreed with the server (`pushedRows.ts`). With the third, a row that is here
and not on the server is either one added here or one deleted elsewhere, and the
two are distinguishable. Without it they are not, and every scheme that guesses
loses somebody's data in one direction or the other. `mergeRows.ts` holds the
rules and the tests.

A failed read returns null and never `[]`, and a device that has not read may not
push. That is what keeps the fix from becoming the bug it fixes: a network blip
rounded down to "no rows" would arm a reconcile that empties the server.

## Export

**HTML** produces a standalone page in the visual language of the source
itinerary sheet: timeline per day, per day cost, and a budget table. Fonts are
linked but every family has a local fallback, so it reads fine offline.

**Text** copies a plain version to the clipboard for pasting into a chat, and
falls back to a download where the clipboard is not available.

**Save a copy** writes a JSON backup of everything this browser holds: the trip,
the ledger, and any places added here. **Restore a copy** reads one back. The
restore validates the shape of every day and item before it accepts the file,
because a malformed backup used to be persisted and then thrown on by the
renderer, which left the app unopenable with no way back.

Backups are the one artefact that carries booking references and seat numbers,
so `backups/` is git ignored apart from its README. Nothing generated into
`src/data/` contains any of it.
