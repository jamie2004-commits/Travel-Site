import { useCallback, useEffect, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import { newId, type StorageState } from './store';
import { CHECKLIST_KEY, CHECKLIST_SECTIONS_KEY } from './storageKeys';
import { syncChecklist, readChecklistForTrip } from './cloudChecklist';
import { readOpenTripId } from './openTrip';
import { mergeRows } from './mergeRows';
import { readPushed, writePushed } from './pushedRows';

/**
 * The two lists a trip needs that are not the trip: what to pack, and what to
 * do before you go.
 *
 * Kept as rows beside the itinerary rather than inside it, for the reasons 0006
 * gives for the ledger. The trip document has a one megabyte ceiling and every
 * save ships all of it, so a checkbox living in there would turn ticking
 * "passport" into an upload of the whole plan. Ticking is also the single most
 * likely thing for two people to do at the same time, on two phones, which is
 * exactly where a compare and swap on one document loses one of them.
 *
 * One list per kind for the whole trip, not one per day. A packing list is not
 * a thing you do on Tuesday.
 */

export type ListKind = 'packing' | 'prep';

export const LIST_KINDS: ListKind[] = ['packing', 'prep'];

export const LIST_LABELS: Record<ListKind, string> = {
  packing: 'Packing',
  prep: 'Before you go',
};

export const LIST_BLURBS: Record<ListKind, string> = {
  packing: 'What goes in the bag. Tick it as it goes in, not as you think of it.',
  prep: 'Everything that has to happen before you leave, in the order it has to happen.',
};

export interface ChecklistItem {
  id: string;
  kind: ListKind;
  text: string;
  done: boolean;
  /**
   * The name of the section this sits in. Absent means it sits in no section,
   * which is a real answer rather than a missing one: most of a list is just
   * things, and making every one of them pick a section before it can be
   * written down is how a list stops getting written down.
   *
   * The NAME and not an id, deliberately. It is what the server column holds
   * and what a backup carries, so a list opened on another device or restored
   * from a file keeps its sections without having to resolve a reference that
   * may not have travelled with it.
   */
  group?: string;
  /** When it was added here, which is what orders a list within its section. */
  addedAt: string;
}

/**
 * A section somebody made, under the name they gave it.
 *
 * Stored, where it used to be inferred from whatever headings the items
 * happened to carry. Inferring is why a section could not be made before it had
 * something in it, could not be renamed, and could not be empty. All three are
 * ordinary things to do while writing a list: you make Carry on bag first and
 * fill it afterwards.
 */
export interface ChecklistSection {
  id: string;
  kind: ListKind;
  name: string;
  addedAt: string;
}

const newItemId = () => newId('chk');
const newSectionId = () => newId('sec');

export const SECTION_NAME_MAX = 60;

export function itemsOfKind(items: ChecklistItem[], kind: ListKind): ChecklistItem[] {
  return items.filter((i) => i.kind === kind);
}

export function sectionsOfKind(sections: ChecklistSection[], kind: ListKind): ChecklistSection[] {
  return [...sections.filter((s) => s.kind === kind)].sort((a, b) =>
    a.addedAt.localeCompare(b.addedAt),
  );
}

/** Two sections in one list cannot share a name, because an item names one. */
export function nameTaken(
  sections: ChecklistSection[],
  kind: ListKind,
  name: string,
  exceptId?: string,
): boolean {
  const wanted = name.trim().toLowerCase();
  return sections.some(
    (s) => s.kind === kind && s.id !== exceptId && s.name.trim().toLowerCase() === wanted,
  );
}

/**
 * Where one item sits: the list it belongs to, and the section within that list.
 *
 * The page draws packing and prep as a single list with the errands as a
 * section in it, so every section chooser on it has to name both halves of
 * that at once, and a `<select>` value is one string. Hence a pair encoded into
 * one. The empty name is the list's no-section bucket, which is a real
 * destination and not a missing one.
 *
 * A unit separator and not a colon, because a section is called whatever
 * somebody typed and "Toiletries: liquids" is a thing somebody types. It lives
 * here rather than in the page because an invisible character in a value is
 * worth a test rather than a comment.
 */
export const SPOT_SEP = '';

export const spotValue = (kind: ListKind, name: string) => `${kind}${SPOT_SEP}${name}`;

export function parseSpot(value: string): { kind: ListKind; name: string } {
  const cut = value.indexOf(SPOT_SEP);
  // Anything that is not a spot at all reads as unfiled packing, which is where
  // an item with nowhere to go belongs anyway.
  if (cut < 0) return { kind: 'packing', name: '' };
  return {
    kind: value.slice(0, cut) === 'prep' ? 'prep' : 'packing',
    name: value.slice(cut + 1),
  };
}

export interface ChecklistGroup {
  /** Null for the no-section bucket, which the page titles itself. */
  section: ChecklistSection | null;
  items: ChecklistItem[];
}

/**
 * A kind's items under the sections they belong to.
 *
 * Sections in the order they were made, then any name found on an item with no
 * section of its own, then the no-section bucket last.
 *
 * That middle case is not hypothetical. Sections live in this browser and it is
 * the item headings that reach the server, so a list opened on a second device
 * arrives as headings with no sections behind them. Rebuilding them from what
 * the items carry is what stops a whole section reading as unfiled over there.
 * An empty section is the one thing that cannot survive that trip, because
 * nothing is carrying its name.
 *
 * The no-section bucket is last because it is where things land when you are in
 * a hurry, and it should not push the organised part of the list down. Within a
 * section, insertion order, and ticked items deliberately do not move: a list
 * that reorders itself under the finger that is ticking it is a list that gets
 * things ticked twice and others missed.
 */
export function groupItems(
  items: ChecklistItem[],
  sections: ChecklistSection[],
): ChecklistGroup[] {
  const ordered = [...items].sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  const byName = new Map<string, ChecklistItem[]>();
  const loose: ChecklistItem[] = [];

  for (const item of ordered) {
    const name = item.group?.trim() ?? '';
    if (!name) {
      loose.push(item);
      continue;
    }
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(item);
  }

  const out: ChecklistGroup[] = [];
  const claimed = new Set<string>();

  for (const section of sections) {
    const name = section.name.trim();
    claimed.add(name);
    out.push({ section, items: byName.get(name) ?? [] });
  }

  for (const [name, group] of byName) {
    if (claimed.has(name)) continue;
    // A heading with no section behind it. Given an id that cannot collide
    // with a real one, so the page can still key on it and can tell that
    // renaming and removing do not apply.
    out.push({
      section: { id: `found:${name}`, kind: group[0].kind, name, addedAt: group[0].addedAt },
      items: group,
    });
  }

  if (loose.length) out.push({ section: null, items: loose });
  return out;
}

/** Whether a group came from a stored section or was rebuilt from item headings. */
export const isFoundSection = (section: ChecklistSection | null) =>
  section !== null && section.id.startsWith('found:');

/** Ticked against total, for the count on the page and in the header. */
export function progress(items: ChecklistItem[]): { done: number; total: number } {
  return { done: items.filter((i) => i.done).length, total: items.length };
}

/**
 * A stored value that is a list of things that look like checklist items.
 *
 * Same reasoning as the ledger and the places: absent is a first visit and safe
 * to write over, unreadable is not, and only the read can tell them apart. The
 * shape check covers the two fields every render walks, because a row with no
 * kind belongs to no list and a row with no id cannot be ticked.
 */
function looksLikeItems(value: unknown): value is ChecklistItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (i) =>
        i &&
        typeof i === 'object' &&
        typeof (i as ChecklistItem).id === 'string' &&
        LIST_KINDS.includes((i as ChecklistItem).kind),
    )
  );
}

function looksLikeSections(value: unknown): value is ChecklistSection[] {
  return (
    Array.isArray(value) &&
    value.every(
      (s) =>
        s &&
        typeof s === 'object' &&
        typeof (s as ChecklistSection).id === 'string' &&
        typeof (s as ChecklistSection).name === 'string' &&
        LIST_KINDS.includes((s as ChecklistSection).kind),
    )
  );
}

export function useChecklist() {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [sections, setSections] = useState<ChecklistSection[]>([]);
  const [storage, setStorage] = useState<StorageState>('loading');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    Promise.all([get<unknown>(CHECKLIST_KEY), get<unknown>(CHECKLIST_SECTIONS_KEY)])
      .then(([storedItems, storedSections]) => {
        if (!mounted.current) return;
        if (storedItems !== undefined && !looksLikeItems(storedItems)) {
          console.error('The stored lists are not lists. Editing will not be saved.', storedItems);
          setStorage('failed');
          return;
        }
        if (storedSections !== undefined && !looksLikeSections(storedSections)) {
          console.error(
            'The stored sections are not sections. Editing will not be saved.',
            storedSections,
          );
          setStorage('failed');
          return;
        }
        if (storedItems) setItems(storedItems);
        if (storedSections) setSections(storedSections);
        setStorage('ready');
      })
      .catch((cause) => {
        if (!mounted.current) return;
        console.error('Could not read the stored lists. Editing will not be saved.', cause);
        setStorage('failed');
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * The read that closes the gap.
   *
   * `pulled` is a permission, not a status: until the server's copy has come
   * back at least once, this device may not push. That is what makes reading
   * safe to add. The old code refused to read at all, on the grounds that a
   * failed read feeding a full reconcile deletes everything on the server --
   * which is true, and is handled here by leaving the pusher disarmed rather
   * than by never reading. `readChecklistForTrip` returns null for "could not
   * read" and never [], so the two cannot collapse into each other.
   *
   * Runs once, when the local copy is in hand. Not on a timer: a pull loop
   * beside a reconcile loop is the race the original comment warned about, and
   * nothing here needs one. Both devices read on load, and the load is the
   * moment the staleness actually matters.
   */
  const [pulled, setPulled] = useState(false);

  useEffect(() => {
    if (storage !== 'ready' || pulled) return;
    let live = true;
    void (async () => {
      const tripId = await readOpenTripId();
      const theirs = await readChecklistForTrip(tripId);
      // Disarmed. Local editing carries on and saves to this browser; nothing
      // reconciles to the server this session, and the next load tries again.
      if (!live || theirs === null) return;
      const pushed = await readPushed<ChecklistItem>('checklist');
      if (!live) return;
      // Functional, because the merge has to run against whatever is in state
      // at this instant rather than whatever it was when this effect started.
      setItems((mine) => mergeRows(mine, theirs, pushed, (i) => i.id).rows);
      setPulled(true);
    })();
    return () => {
      live = false;
    };
  }, [storage, pulled]);

  // Write through only once the stored copy has been read. Saving an empty list
  // over real rows on the first render is the one failure here that cannot be
  // undone, and it is what a read that threw would otherwise cause.
  useEffect(() => {
    if (storage !== 'ready') return;
    void set(CHECKLIST_KEY, items).catch((cause) => {
      console.error('Could not save the lists to this browser.', cause);
    });
  }, [items, storage]);

  useEffect(() => {
    if (storage !== 'ready') return;
    void set(CHECKLIST_SECTIONS_KEY, sections).catch((cause) => {
      console.error('Could not save the sections to this browser.', cause);
    });
  }, [sections, storage]);

  /**
   * Keep the server's copy in step with this one.
   *
   * Same gate as the local write through, and the reason is sharper here:
   * syncChecklist reconciles, so it sends deletions for anything the server
   * has and this list does not. Until the stored copy has been read this list
   * is empty, and an empty list reconciled against a full server deletes all
   * of it. 'ready' is the only state where this list means anything.
   *
   * There is deliberately no pull loop beside this. The lists arrive with a
   * trip opened by its code, the way the ledger does, so nothing here can race
   * a reconcile. A background pull plus a reconcile on a timer is the shape to
   * avoid: the first pull that fails looks like "everything was deleted" to the
   * reconcile that follows, and it then makes that true on the server.
   *
   * Only the items go up. A section reaches the server as the name written on
   * each of its items, so the one thing that does not travel is a section with
   * nothing in it yet.
   *
   * Debounced at four seconds like the ledger, because ticking a packing list
   * is a burst of ten taps and each save reconciles the whole thing.
   */
  const pending = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (storage !== 'ready' || !pulled) return;
    window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      void syncChecklist(items).then((result) => {
        // Only a push the server took counts as an agreement. Recording one it
        // refused would make the next merge read the rows it never got as rows
        // somebody else deleted, and delete them here to match.
        if (result.ok) void writePushed('checklist', items);
        // Quiet on failure. The lists are safe in this browser either way and
        // the next edit retries. A project that has not run 0010 reports
        // missing-table on every pass, which is a setup state, not a fault.
        if (!result.ok && result.kind !== 'local' && result.kind !== 'missing-table') {
          console.warn('Could not save the lists to the server.', result.message);
        }
      });
    }, 4000);
    return () => window.clearTimeout(pending.current);
  }, [items, storage, pulled]);

  const add = useCallback((kind: ListKind, text: string, group?: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setItems((list) => [
      ...list,
      {
        id: newItemId(),
        kind,
        text: trimmed,
        done: false,
        ...(group?.trim() ? { group: group.trim() } : {}),
        addedAt: new Date().toISOString(),
      },
    ]);
  }, []);

  const update = useCallback((id: string, patch: Partial<ChecklistItem>) => {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  const toggle = useCallback((id: string) => {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((list) => list.filter((i) => i.id !== id));
  }, []);

  /** Clear the ticked ones from one list, which is the end of a packing session. */
  const clearDone = useCallback((kind: ListKind) => {
    setItems((list) => list.filter((i) => !(i.kind === kind && i.done)));
  }, []);

  /** Untick everything in one list, for the next trip rather than this one. */
  const resetKind = useCallback((kind: ListKind) => {
    setItems((list) => list.map((i) => (i.kind === kind ? { ...i, done: false } : i)));
  }, []);

  /**
   * Make a section under whatever name was typed.
   *
   * Refuses a blank one and refuses a name already in use in that list, since
   * an item names its section: two called Carry on bag would be one section
   * wearing two headings, and removing either would empty both.
   */
  const addSection = useCallback((kind: ListKind, name: string): boolean => {
    const trimmed = name.trim().slice(0, SECTION_NAME_MAX);
    if (!trimmed) return false;
    let made = false;
    setSections((list) => {
      if (nameTaken(list, kind, trimmed)) return list;
      made = true;
      return [
        ...list,
        { id: newSectionId(), kind, name: trimmed, addedAt: new Date().toISOString() },
      ];
    });
    return made;
  }, []);

  /**
   * Rename a section, and every item filed under it, in one go.
   *
   * Both halves together, because an item names its section: renaming one
   * without the other leaves every item behind under a heading rebuilt from
   * their own text, which reads as the items having been moved out rather than
   * the section having been renamed.
   */
  const renameSection = useCallback((id: string, name: string) => {
    const trimmed = name.trim().slice(0, SECTION_NAME_MAX);
    if (!trimmed) return;
    setSections((list) => {
      const found = list.find((s) => s.id === id);
      if (!found || found.name === trimmed) return list;
      if (nameTaken(list, found.kind, trimmed, id)) return list;
      const was = found.name;
      setItems((current) =>
        current.map((i) =>
          i.kind === found.kind && (i.group ?? '') === was ? { ...i, group: trimmed } : i,
        ),
      );
      return list.map((s) => (s.id === id ? { ...s, name: trimmed } : s));
    });
  }, []);

  /**
   * Remove a section. What was in it stays, and becomes unfiled.
   *
   * Never a delete of the contents. Finding out halfway through that Carry on
   * bag was the wrong division is ordinary, and it should not cost the eleven
   * things already written down under it.
   */
  const removeSection = useCallback((id: string) => {
    setSections((list) => {
      const found = list.find((s) => s.id === id);
      if (!found) return list;
      setItems((current) =>
        current.map((i) => {
          if (i.kind !== found.kind || (i.group ?? '') !== found.name) return i;
          const { group: _gone, ...rest } = i;
          return rest;
        }),
      );
      return list.filter((s) => s.id !== id);
    });
  }, []);

  /** Move one item into a section, or out of all of them when given ''. */
  const fileUnder = useCallback((id: string, name: string) => {
    setItems((list) =>
      list.map((i) => {
        if (i.id !== id) return i;
        if (!name.trim()) {
          const { group: _gone, ...rest } = i;
          return rest;
        }
        return { ...i, group: name.trim() };
      }),
    );
  }, []);

  return {
    items,
    sections,
    loaded: storage !== 'loading',
    storage,
    add,
    update,
    toggle,
    remove,
    clearDone,
    resetKind,
    addSection,
    renameSection,
    removeSection,
    fileUnder,
  };
}

export type ChecklistStore = ReturnType<typeof useChecklist>;
