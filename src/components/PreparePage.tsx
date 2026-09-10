import { useState } from 'react';
import type { Itinerary } from '../types';
import {
  GROUP_HINTS,
  LIST_BLURBS,
  LIST_KINDS,
  LIST_LABELS,
  groupItems,
  itemsOfKind,
  progress,
  type ChecklistStore,
  type ListKind,
} from '../lib/checklist';

interface Props {
  itinerary: Itinerary;
  /**
   * Owned by the page shell rather than here, the way the ledger is, and for
   * the same two reasons. The hook that holds the lists is also the thing that
   * pushes them, so mounted here that push would only happen while this page
   * was open. And the read happens once at load, where a hook mounted per
   * visit would re-read on every navigation and flash an empty list at
   * somebody halfway through packing.
   */
  checklist: ChecklistStore;
  onSheet: () => void;
  onEdit: () => void;
  onActivities: () => void;
  onExpenses: () => void;
}

export default function PreparePage({
  itinerary,
  checklist,
  onSheet,
  onEdit,
  onActivities,
  onExpenses,
}: Props) {
  return (
    <div className="sheet">
      <header>
        <div className="wrap">
          <div className="eyebrow">Prepare · what to pack and what to do first</div>
          <h1 className="zh">{itinerary.name}</h1>
          <div className="sub">
            Two lists that belong to the trip rather than to a day in it. They save as you
            type, travel with the trip code, and are carried by Save a copy.
          </div>

          <dl className="stats">
            {LIST_KINDS.map((kind) => {
              const at = progress(itemsOfKind(checklist.items, kind));
              return (
                <div key={kind}>
                  <dt>{LIST_LABELS[kind]}</dt>
                  <dd>
                    {at.total ? `${at.done} of ${at.total}` : 'Nothing yet'}
                  </dd>
                </div>
              );
            })}
          </dl>

          <div className="heroactions">
            <button type="button" className="edit ghost" onClick={onSheet}>
              Itinerary
            </button>
            <button type="button" className="edit ghost" onClick={onEdit}>
              Edit this trip
            </button>
            <button type="button" className="edit ghost" onClick={onActivities}>
              Activities
            </button>
            <button type="button" className="edit ghost" onClick={onExpenses}>
              Expenses
            </button>
          </div>
        </div>
      </header>

      <main>
        {checklist.storage === 'failed' && (
          <p className="prepwarn" role="alert">
            <b>This browser will not let these lists be read.</b> Anything ticked or added here
            is lost on reload. Private browsing and blocked site data are the usual causes.
          </p>
        )}

        {LIST_KINDS.map((kind) => (
          <ChecklistSection key={kind} kind={kind} checklist={checklist} />
        ))}
      </main>

      <footer>Safe travels</footer>
    </div>
  );
}

function ChecklistSection({ kind, checklist }: { kind: ListKind; checklist: ChecklistStore }) {
  const [text, setText] = useState('');
  const [group, setGroup] = useState('');
  const mine = itemsOfKind(checklist.items, kind);
  const groups = groupItems(mine);
  const at = progress(mine);

  return (
    <section className="prep" id={kind}>
      <h2>
        {LIST_LABELS[kind]}
        <span className="en">{LIST_BLURBS[kind]}</span>
      </h2>

      <form
        className="prepform"
        onSubmit={(e) => {
          e.preventDefault();
          checklist.add(kind, text, group);
          // The heading is deliberately kept, the item is not. Somebody adding
          // a packing list adds six things under Clothes in a row, and making
          // them retype the heading each time is what turns a list into a flat
          // one.
          setText('');
        }}
      >
        <label className="prepwhat">
          <span className="eyebrow">Add</span>
          <input
            className="field"
            value={text}
            placeholder={kind === 'packing' ? 'Passport' : 'Tell the bank about the trip'}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label className="prepgroup">
          <span className="eyebrow">Under</span>
          <input
            className="field"
            value={group}
            list={`groups-${kind}`}
            placeholder="Optional"
            maxLength={60}
            onChange={(e) => setGroup(e.target.value)}
          />
          <datalist id={`groups-${kind}`}>
            {[...new Set([...groups.map((g) => g.title).filter(Boolean), ...GROUP_HINTS[kind]])].map(
              (hint) => (
                <option key={hint} value={hint} />
              ),
            )}
          </datalist>
        </label>
        <button type="submit" className="edit" disabled={!text.trim()}>
          Add
        </button>
      </form>

      {at.total === 0 ? (
        <p className="prepempty">
          Nothing on this list yet. Type the first thing above; a heading is optional and only
          exists while something is filed under it.
        </p>
      ) : (
        <>
          {groups.map((g) => (
            <div className="prepgroupblock" key={g.title || '__unfiled'}>
              <h3>
                {g.title || 'Everything else'}
                <span>
                  {progress(g.items).done} of {g.items.length}
                </span>
              </h3>
              <ul className="preplist">
                {g.items.map((item) => (
                  <li key={item.id} className={item.done ? 'done' : undefined}>
                    <label>
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={() => checklist.toggle(item.id)}
                      />
                      <input
                        className="preptext"
                        value={item.text}
                        maxLength={200}
                        aria-label="What this is"
                        onChange={(e) => checklist.update(item.id, { text: e.target.value })}
                      />
                    </label>
                    <button
                      type="button"
                      className="prepremove"
                      aria-label={`Remove ${item.text}`}
                      onClick={() => checklist.remove(item.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="prepactions">
            <span className="prepcount">
              {at.done} of {at.total} ticked
            </span>
            {at.done > 0 && (
              <>
                <button type="button" onClick={() => checklist.resetKind(kind)}>
                  Untick all
                </button>
                {/*
                  Two different endings, and they are not the same one. Untick
                  keeps the list for the next trip; Clear ticked throws away
                  what is done and keeps what is not, which is what you want
                  when the list was for this trip only.
                */}
                <button type="button" onClick={() => checklist.clearDone(kind)}>
                  Clear ticked
                </button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
