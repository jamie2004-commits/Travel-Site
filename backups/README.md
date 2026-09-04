# Backups

Exported trips and database snapshots. **Nothing in here is committed.**

`.gitignore` excludes everything in this folder except this file, because a trip
carries things the repo must not publish: flight numbers and seat numbers, hotel
phone numbers, and booking references. `BRIEF.md` says it outright, about the
source guides:

> Strip personal information: no names beyond first names, no booking
> references, no hotel confirmation numbers.

The same rule applies to an exported trip, and it applies harder here, because
this repository is public.

## Putting a trip here

Until the app has an export button, from the browser console on the site whose
trip you want, with DevTools open:

```js
const db = await new Promise((ok, no) => {
  const r = indexedDB.open('keyval-store');
  r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
});
const dump = await new Promise((ok, no) => {
  const tx = db.transaction('keyval', 'readonly').objectStore('keyval');
  const k = tx.getAllKeys(), v = tx.getAll();
  tx.transaction.oncomplete = () => ok(Object.fromEntries(k.result.map((key, i) => [key, v.result[i]])));
  tx.transaction.onerror = () => no(tx.transaction.error);
});
const a = document.createElement('a');
a.href = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' }));
a.download = `trip-backup-${new Date().toISOString().slice(0, 10)}.json`;
a.click();
```

Then move the downloaded file into this folder.

Storage is per origin, so the deployed site and `localhost:3000` hold different
trips. Run it on whichever one you actually plan in.

## Checking a backup is real

Open the file. `itinerary-builder/v1` should hold your trip, with a `days` array
that has your day labels and stops in it. An empty `days`, or a missing key,
means the export ran somewhere your trip is not.

A backup nobody has opened is not a backup.
