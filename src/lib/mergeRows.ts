import { canonical } from './syncMeta';

/**
 * Reconciling two copies of a list of rows, given what was last agreed.
 *
 * The expenses ledger and the packing lists are rows, not documents. That is
 * deliberate and it is why neither has a version or a compare-and-swap: two
 * devices adding two different receipts should both keep them, which a
 * whole-document swap cannot express. What rows need instead is this.
 *
 * ------------------------------------------------------------------------
 *
 * The bug this exists to fix. Both lists pushed a full reconcile -- "these are
 * all the rows there are, delete anything else" -- and never read back after
 * the trip was first opened. A device that had not read since then was holding
 * a stale list, and its next push deleted every row added anywhere else. The
 * hooks mount app-wide, so merely opening the app was enough to fire it.
 *
 * Reading on load fixes that only if the read is merged rather than obeyed.
 * Taking the server's answer wholesale would throw away edits made here and not
 * yet pushed, which is the same bug pointing the other way.
 *
 * ------------------------------------------------------------------------
 *
 * So: three copies, and the third is what makes it decidable.
 *
 *   `local`      what this device holds now
 *   `server`     what the server holds now
 *   `lastPushed` what this device last successfully agreed with the server
 *
 * With `lastPushed`, a row missing from the server is two distinguishable
 * things rather than one ambiguous one:
 *
 *   Present in lastPushed, absent from server -- somebody deleted it elsewhere,
 *   after we last agreed. It should go here too.
 *
 *   Absent from lastPushed, present here -- it was added here since, and the
 *   server has simply never heard of it. It should stay, and go up.
 *
 * Without that third copy those two are indistinguishable, and every scheme
 * that guesses between them loses somebody's data in one direction or the
 * other. Which is exactly what the old code did by never reading at all.
 */

export interface RowMerge<T> {
  /** What the list should be after reconciling. */
  rows: T[];
  /** Rows the server has never seen. Non-empty means this device must push. */
  added: T[];
  /** Rows that were deleted elsewhere and are being dropped here. */
  removed: T[];
}

export function mergeRows<T>(
  local: T[],
  server: T[],
  lastPushed: T[] | null,
  idOf: (row: T) => string,
): RowMerge<T> {
  const serverById = new Map(server.map((r) => [idOf(r), r]));
  const localById = new Map(local.map((r) => [idOf(r), r]));
  /**
   * Null means this device has never agreed with the server, or the record of
   * it was lost. Every absence is then unexplainable, and the only choice that
   * cannot destroy data is to keep everything and let a later, better informed
   * pass sort it out. A first sync that keeps a duplicate is recoverable by
   * hand; one that deletes a row is not.
   */
  const pushedById = lastPushed ? new Map(lastPushed.map((r) => [idOf(r), r])) : null;

  const rows: T[] = [];
  const added: T[] = [];
  const removed: T[] = [];

  // The server's rows lead, so the order two devices see converges on one
  // answer rather than depending on which of them is looking.
  for (const row of server) {
    const id = idOf(row);
    const here = localById.get(id);
    if (!here) {
      rows.push(row);
      continue;
    }

    /**
     * Both have it and they differ. Whether this device's copy is an edit or
     * merely stale is, again, only answerable against what was last agreed:
     * unchanged since then means the difference came from the other side and
     * theirs is newer. Changed here means an unpushed edit, and dropping it
     * would lose a tick made on this device a moment ago.
     *
     * Both edited since is a genuine conflict with no timestamp to settle it.
     * This device wins, deliberately: it is the one someone is looking at, and
     * a tick that silently untick itself under the finger that made it is the
     * worse of the two failures.
     */
    const pushed = pushedById?.get(id);
    const dirty = !pushedById || !pushed || canonical(here) !== canonical(pushed);
    rows.push(dirty ? here : row);
    if (dirty && canonical(here) !== canonical(row)) added.push(here);
  }

  for (const row of local) {
    const id = idOf(row);
    if (serverById.has(id)) continue;

    // Known to have existed and now gone from the server: deleted elsewhere.
    if (pushedById?.has(id)) {
      removed.push(row);
      continue;
    }

    // Never pushed, so the server cannot have deleted what it never had.
    rows.push(row);
    added.push(row);
  }

  return { rows, added, removed };
}
