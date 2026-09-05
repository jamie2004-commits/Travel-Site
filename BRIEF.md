# Itinerary Builder: Build Brief

Paste into Claude Code as the opening prompt. Put `shanghai-hangzhou-food-guide.html` and `itinerary.html` in the same folder first.

---

## What this is

A single-page tool for building a trip itinerary by browsing curated places and dragging them into days.

Left side: a browsable library of places, filtered by city, district and category.
Right side: my itinerary, organised by day.
I pick things from the library, add them to a day, reorder them, adjust times, and export the result.

That is the whole product. Nothing else.

## Explicitly not in this build

No maps, no SEO, no payments, no AI generation. Do not add them. Do not scaffold
for them.

**Superseded on 2026-09-05, by explicit decision.** This section originally also
ruled out accounts, a database, a server and sharing links. The trip is now kept
in Supabase Postgres and a trip can be opened on another machine by its code, so
that part of the brief no longer describes the build. There is still no sign in:
every browser takes an anonymous identity instead. Kept here rather than deleted
so the change of direction is visible, and so nobody reverts it as drift.

## Stack

- Vite + React + TypeScript
- Tailwind CSS as a build dependency, not the CDN script tag
- `dnd-kit` for drag and drop
- `idb-keyval` or plain localStorage for persistence
- Data as typed TS files in `src/data/`
- No other dependencies without asking me first

## Step one: migrate the existing data

Write a Node script in `scripts/extract.mjs` that parses the two HTML files in this folder and emits typed data files.

From `shanghai-hangzhou-food-guide.html`: 53 food places across Shanghai (7 districts) and Hangzhou (5 districts). Each has a Chinese name, English name, description, tags, price range, address and nearest metro station.

From `itinerary.html`: an 8 day trip with per-item timings, notes and cost estimates. Extract the non-food items (temples, West Lake, Disneyland, tea plantation, shopping and so on) as activity places, and extract the day structure as a starter itinerary.

Do not hand-copy the data. Do not invent anything that is not in the source files. Print a report of anything that came out incomplete.

Strip personal information: no names beyond first names, no booking references, no hotel confirmation numbers.

## Types

```ts
type City = 'shanghai' | 'hangzhou';
type Category = 'food' | 'sight' | 'activity' | 'shopping';

interface Place {
  id: string;
  nameZh: string;          // primary display name
  nameEn: string;          // secondary
  city: City;
  district: string;        // district id
  category: Category;
  description: string;
  tags: string[];
  priceMin?: number;       // RMB per person
  priceMax?: number;
  addressZh?: string;
  metro?: string;          // e.g. "Line 1 · Hubin"
  durationMinutes?: number; // typical time needed, used as a default
}

interface District {
  id: string;
  city: City;
  nameZh: string;
  nameEn: string;
  accentColor: string;
}

interface ItineraryItem {
  id: string;              // unique per item, not the place id
  placeId?: string;        // omit for custom entries like "Nap"
  customTitle?: string;
  startTime?: string;      // "14:00" — stops have no end time
  note?: string;
  estCostMin?: number;
  estCostMax?: number;
  travel?: Travel;         // set when the stop is a booked flight or train
}

interface Day {
  id: string;
  date?: string;           // ISO, optional
  label: string;           // "Day 1"
  items: ItineraryItem[];
}

interface Itinerary {
  name: string;
  days: Day[];
}
```

A place can appear in the itinerary more than once. Items carry their own id so duplicates work.

## Layout

Two panes on desktop, side by side. Library left, itinerary right, both independently scrollable.

On mobile, two tabs: Browse and My Trip. Adding from Browse shows a brief confirmation and stays put, it does not jump the user to the other tab.

## Library pane

- City toggle: Shanghai / Hangzhou, with the accent palette switching per city as in the existing guide
- Category filter: All / Food / Sights / Activities / Shopping
- District filter, shown as tabs or a dropdown
- Text search across Chinese name, English name and tags
- Result count
- Place cards showing: Chinese name large and primary, English name smaller beneath, description, tags, price range, metro
- Each card has an "add" control. If the itinerary has more than one day, adding opens a small day picker. If there is exactly one day, it adds straight to it.
- Cards already used in the itinerary show a subtle marker with a count

## Itinerary pane

- Editable trip name
- Add day, remove day, reorder days
- Each day shows its items in order
- Drag to reorder within a day and to move between days
- Drag from the library directly onto a day also works on desktop
- Each item is editable inline: start time, duration, free-text note
- Add a custom item to any day with no linked place, for things like "Nap" or "Fly home"
- Remove an item
- Per-day cost estimate range, summed from item costs
- Trip total at the top
- Empty days show a hint rather than blank space

## Behaviour

- Everything persists automatically to browser storage. Reloading the page restores exactly what was there.
- Undo for the last destructive action, at minimum for deleting an item or a day
- A reset button that clears everything, behind a confirmation
- Export the itinerary as a self-contained HTML file, styled like the existing `itinerary.html`, that can be opened offline or sent to someone
- Export as plain text as a secondary option, for pasting into a chat

## Design

- Chinese names and district labels are the primary, larger typography. English is secondary and smaller. Applies to cards, headings and tabs.
- No em dashes anywhere in UI copy.
- CSS custom properties for theming so the per-city palette swap works cleanly.
- Mobile first. Large touch targets.
- Clean console, no warnings on load.
- Match the visual language of the two existing HTML files rather than inventing a new one.

## Build order

Separate commits, pause after each so I can review.

1. Vite scaffold, Tailwind, types
2. Extraction script and generated data files
3. Library pane with all filters working, no itinerary yet
4. Itinerary pane, add and remove, persistence
5. Drag and drop, reordering, moving between days
6. Inline editing, custom items, cost totals
7. Export

## Definition of done

I can open the app, filter to Hangzhou food in Xihu district, add three places to Day 1, drag one of them to Day 2, set its time to 19:00, add a custom item called "Nap", see the day's cost estimate, close the tab, reopen it and find everything intact, then export the whole thing as an HTML file I can send to someone.
