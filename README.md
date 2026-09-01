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
npm run dev      # http://localhost:5173
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

Setting up the database:

1. Run `supabase/migrations/0001_catalog.sql` in the SQL editor.
2. Run `supabase/seed.sql`, which `npm run extract` generates alongside the
   TypeScript. It is idempotent and keyed on the slug, so re-running it after a
   source correction updates rows in place and every place keeps its uuid.

To check a project is set up, run `supabase/check.sql` in the SQL editor. It
reports row counts, whether row level security is on, and whether anything has
left the catalog writable by anonymous visitors.

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
