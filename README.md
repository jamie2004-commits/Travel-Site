# 行程编排 Itinerary Builder

Two pages over one Shanghai and Hangzhou trip. No accounts, no server, no
database: everything lives in the browser.

**The sheet** (`#/`) is what the app opens on and what you read on the trip: a
typeset itinerary with a timeline per day and a budget table, in the visual
language of the hand written itinerary page. It renders whatever is stored, and
prints cleanly.

**The builder** (`#/build`) is where you change it: the place library on the
left, the itinerary on the right, and a day rail across the top that decides
which day everything adds to.

Both read the same stored trip, so an edit in one shows up in the other. The
route lives in the hash, so a link to either page survives a reload.

## Running it

```
npm install
npm run dev      # http://localhost:3000
npm run build    # typecheck and bundle into dist/
npm run extract  # regenerate src/data/ from source/
```

## Where the data comes from

`source/` holds the four guide files the data was migrated from:

| File | What it contributes |
| --- | --- |
| `shanghai-hangzhou-food-guide.html` | 47 food places across 7 Shanghai and 5 Hangzhou districts |
| `classic-shanghai-guide.html` | Shanghai sights, nightlife and food experiences |
| `shanghai-fun-guide.html` | escape rooms, karting and other activities |
| `classic-hangzhou-guide.html` | Hangzhou sights, food and day trips |
| `hangzhou-fun-guide.html` | Hangzhou escape rooms, karting and other activities |
| `itinerary.html` | the 8 day starter trip, and the non food places it visits |

`scripts/extract.mjs` parses them and writes `src/data/places.ts`,
`src/data/districts.ts` and `src/data/starterItinerary.ts`. Those three files are
generated: edit the script, not the output.

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
    format.ts           price, duration and cost sum formatting
    export.ts           HTML and plain text export
    places.ts           lookups by id
  route.ts              which of the two pages is showing
  sheet.css             the itinerary sheet, scoped so it never reaches the builder
  components/
    ItineraryView.tsx   the sheet: hero, day timelines, budget table
    LibraryPane.tsx     filters and results
    ItineraryPane.tsx   trip name, totals, days
    DayCard.tsx         one day: droppable, sortable, custom item field
    ItemRow.tsx         one item, with its inline edit panel
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

Both 6 and 7 end with a block of checks. Every row should say `ok`.

Then, in the dashboard: **Authentication → Sign In / Providers → Anonymous
Sign-Ins → enable**. Every browser then quietly holds a real account, which is
what `auth.uid()` needs and therefore what every policy above is written
against. There is no sign in screen and nothing to remember. Adding email sign
in later upgrades the same account, so no data has to move.

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
catalog is about a hundred rows, so it is fetched once and filtered in the
browser: search stays instant and the library survives losing the connection.

### Adding places

The **添加地点 Add a place** button in the library takes a new place and stores
it in this browser, alongside the itinerary. Added places are marked, can be
deleted, and behave like any other place: filter, search, drag into a day,
export.

They are deliberately not written to Supabase. Row level security lets anyone
read the catalog and only a signed in user write to it, and there is no sign in
yet. The insert, update and delete policies are already in the migration, so
adding auth is what connects the two, not a rewrite.

Making the catalog writable by anonymous visitors instead is one policy change,
commented at the bottom of the migration. It is an open write endpoint on the
public internet, since the anon key ships inside the bundle. Fine for a personal
deployment, not for a public site.

## Export

**HTML** produces a standalone page in the visual language of the source
itinerary sheet: timeline per day, per day cost, and a budget table. Fonts are
linked but every family has a local fallback, so it reads fine offline.

**Text** copies a plain version to the clipboard for pasting into a chat, and
falls back to a download where the clipboard is not available.
