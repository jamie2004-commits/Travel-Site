import { useCallback, useEffect, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import { newId, type StorageState } from './store';
import { CHECKLIST_KEY } from './storageKeys';
import { syncChecklist } from './cloudChecklist';

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

/**
 * Offered in the add form as a datalist rather than a fixed set, because a
 * section is free text: these are a running start, not a schema. Anything typed
 * becomes a heading the moment one item carries it and stops being one when the
 * last item leaves it, which is what keeps this out of the stored shape.
 *
 * The bags come first on the packing list because that is the division that
 * actually decides anything on the morning you leave. Which bag a thing is in
 * is a question you answer at a bag drop with a queue behind you; whether it is
 * a toiletry is not. The categories stay underneath for anyone who packs the
 * other way round, and both are only suggestions.
 */
export const GROUP_HINTS: Record<ListKind, string[]> = {
  packing: [
    'Carry on bag',
    'Checked luggage',
    'Day bag',
    'Wearing on the plane',
    'Documents',
    'Electronics',
    'Toiletries',
    'Medicine',
  ],
  prep: ['Book', 'Two weeks before', 'The week before', 'The night before', 'At the airport'],
};

/** What the add form calls the heading field, and what it puts in it as a hint. */
export const GROUP_FIELD: Record<ListKind, { label: string; placeholder: string }> = {
  packing: { label: 'Which bag', placeholder: 'Carry on bag' },
  prep: { label: 'When', placeholder: 'The night before' },
};

export interface ChecklistItem {
  id: string;
  kind: ListKind;
  text: string;
  done: boolean;
  /** A free text heading. Absent means it sits in the unfiled bucket at the end. */
  group?: string;
  /** When it was added here, which is what orders a list within its group. */
  addedAt: string;
}

const newItemId = () => newId('chk');

export function itemsOfKind(items: ChecklistItem[], kind: ListKind): ChecklistItem[] {
  return items.filter((i) => i.kind === kind);
}

export interface ChecklistGroup {
  /** Empty string for the unfiled bucket, which the page titles itself. */
  title: string;
  items: ChecklistItem[];
}

/**
 * A kind's items under their headings.
 *
 * Groups come out in the order they were first used rather than alphabetically,
 * so a list reads in the order it was built: somebody writing a packing list
 * types Documents first because that is what they think of first, and sorting
 * that under Clothes helps nobody. The unfiled bucket is always last, because
 * it is where things land when you are in a hurry and it should not push the
 * organised part of the list down.
 *
 * Within a group, insertion order, and ticked items deliberately do not move.
 * A list that reorders itself under the finger that is ticking it is a list
 * that gets things ticked twice and others missed.
 */
export function groupItems(items: ChecklistItem[]): ChecklistGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, ChecklistItem[]>();

  for (const item of [...items].sort((a, b) => a.addedAt.localeCompare(b.addedAt))) {
    const title = item.group?.trim() ?? '';
    if (!buckets.has(title)) {
      buckets.set(title, []);
      order.push(title);
    }
    buckets.get(title)!.push(item);
  }

  const named = order.filter((t) => t !== '');
  const rest = order.includes('') ? [''] : [];
  return [...named, ...rest].map((title) => ({ title, items: buckets.get(title)! }));
}

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

export function useChecklist() {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [storage, setStorage] = useState<StorageState>('loading');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    get<unknown>(CHECKLIST_KEY)
      .then((stored) => {
        if (!mounted.current) return;
        if (stored !== undefined && !looksLikeItems(stored)) {
          console.error('The stored lists are not lists. Editing will not be saved.', stored);
          setStorage('failed');
          return;
        }
        if (stored) setItems(stored);
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

  // Write through only once the stored copy has been read. Saving an empty list
  // over real rows on the first render is the one failure here that cannot be
  // undone, and it is what a read that threw would otherwise cause.
  useEffect(() => {
    if (storage !== 'ready') return;
    void set(CHECKLIST_KEY, items).catch((cause) => {
      console.error('Could not save the lists to this browser.', cause);
    });
  }, [items, storage]);

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
   * Debounced at four seconds like the ledger, because ticking a packing list
   * is a burst of ten taps and each save reconciles the whole thing.
   */
  const pending = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (storage !== 'ready') return;
    window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      void syncChecklist(items).then((result) => {
        // Quiet on failure. The lists are safe in this browser either way and
        // the next edit retries. A project that has not run 0010 reports
        // missing-table on every pass, which is a setup state, not a fault.
        if (!result.ok && result.kind !== 'local' && result.kind !== 'missing-table') {
          console.warn('Could not save the lists to the server.', result.message);
        }
      });
    }, 4000);
    return () => window.clearTimeout(pending.current);
  }, [items, storage]);

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

  return {
    items,
    loaded: storage !== 'loading',
    storage,
    add,
    update,
    toggle,
    remove,
    clearDone,
    resetKind,
  };
}

export type ChecklistStore = ReturnType<typeof useChecklist>;
