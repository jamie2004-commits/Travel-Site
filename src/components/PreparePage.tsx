import { useState } from 'react';
import type { Itinerary } from '../types';
import {
  LIST_KINDS,
  LIST_LABELS,
  SECTION_NAME_MAX,
  groupItems,
  isFoundSection,
  itemsOfKind,
  nameTaken,
  parseSpot,
  progress,
  sectionsOfKind,
  spotValue,
  type ChecklistItem,
  type ChecklistSection,
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

/**
 * One page, one list.
 *
 * Packing and Before you go used to be two lists with a heading, a pair of
 * forms and a count each. They are one list here, and the errands are a
 * section in it, the way a printed packing list puts Before leaving in the
 * second column under Day bag rather than on a page of its own. Two lists meant
 * the second one was below the fold, and the thing that gets forgotten is never
 * the packing.
 *
 * The kinds are still there underneath. Items keep `kind: 'packing' | 'prep'`,
 * the server still holds two lists, and a backup still carries both, so this is
 * a change to what is drawn and not to what is stored. What the page has to do
 * for that is carry the kind alongside the section name everywhere a section
 * can be chosen, which is what `spotValue` and `parseSpot` are for.
 */

/** What the no-section bucket of each kind is called once they are one list. */
const LOOSE_TITLES: Record<ListKind, string> = {
  packing: 'Everything else',
  prep: LIST_LABELS.prep,
};

interface Block {
  key: string;
  kind: ListKind;
  /** Null for a no-section bucket, which is titled from its kind. */
  section: ChecklistSection | null;
  title: string;
  items: ChecklistItem[];
}

/**
 * Every section on the page, both kinds, in the order they are read: the
 * packing sections, then what is unfiled in packing, then the same for the
 * errands. A kind with nothing in it contributes nothing, so Before you go
 * appears when the first errand is written and not before.
 */
function blocksOf(checklist: ChecklistStore): Block[] {
  return LIST_KINDS.flatMap((kind) =>
    groupItems(itemsOfKind(checklist.items, kind), sectionsOfKind(checklist.sections, kind)).map(
      (group) => ({
        key: spotValue(kind, group.section ? group.section.id : '__loose'),
        kind,
        section: group.section,
        title: group.section ? group.section.name : LOOSE_TITLES[kind],
        items: group.items,
      }),
    ),
  );
}

/** The destinations both selects offer, in the order the page reads. */
function spotsOf(blocks: Block[]): { value: string; label: string }[] {
  const out = [{ value: spotValue('packing', ''), label: 'No section' }];
  for (const block of blocks) {
    if (block.section) out.push({ value: spotValue(block.kind, block.title), label: block.title });
  }
  // Always offered, whether or not there is an errand written down yet: it is
  // how the first one gets written down.
  out.push({ value: spotValue('prep', ''), label: LIST_LABELS.prep });
  return out;
}

export default function PreparePage({
  itinerary,
  checklist,
  onSheet,
  onEdit,
  onActivities,
  onExpenses,
}: Props) {
  const at = progress(checklist.items);

  return (
    <div className="sheet prepsheet">
      <header>
        <div className="wrap">
          <div className="eyebrow">Prepare · what to pack and what to do first</div>
          <h1 className="zh">{itinerary.name}</h1>
          <div className="sub">
            One list that belongs to the trip rather than to a day in it. It saves as you type,
            travels with the trip code, and is carried by Save a copy.
          </div>

          <dl className="stats">
            <div>
              <dt>Ticked</dt>
              <dd>{at.total ? `${at.done} of ${at.total}` : 'Nothing yet'}</dd>
            </div>
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
            <b>This browser will not let this list be read.</b> Anything ticked or added here is
            lost on reload. Private browsing and blocked site data are the usual causes.
          </p>
        )}

        <ListBlock checklist={checklist} />
      </main>

      <footer>Safe travels</footer>
    </div>
  );
}

function ListBlock({ checklist }: { checklist: ChecklistStore }) {
  const [text, setText] = useState('');
  /** The spot the add form files into. Packing with no section, to begin. */
  const [into, setInto] = useState(spotValue('packing', ''));
  const [newSection, setNewSection] = useState('');
  const [sectionError, setSectionError] = useState<string | null>(null);

  const blocks = blocksOf(checklist);
  const spots = spotsOf(blocks);
  const at = progress(checklist.items);

  function makeSection() {
    const name = newSection.trim();
    if (!name) return;
    // Checked against both kinds rather than the one it is made in. Two
    // sections of the same name are allowed underneath, since an item names its
    // section within its own list, but on one page they would be two headings
    // that look like a mistake.
    if (LIST_KINDS.some((kind) => nameTaken(checklist.sections, kind, name))) {
      setSectionError(`There is already a section called ${name}.`);
      return;
    }
    // New sections are packing ones. The errands are a section already, and
    // dividing them further is not what the list is short of.
    checklist.addSection('packing', name);
    setSectionError(null);
    setNewSection('');
    // Selected straight away, because making a section is something you do in
    // order to put the next thing into it.
    setInto(spotValue('packing', name));
  }

  return (
    <section className="prep">
      <h2>
        Packing list
        <span className="en">Tick it as it goes in, not as you think of it.</span>
      </h2>

      <div className="prepsections">
        <label className="prepnewsection">
          <span className="eyebrow">New section</span>
          <input
            className="field"
            value={newSection}
            placeholder="Carry on bag"
            maxLength={SECTION_NAME_MAX}
            onChange={(e) => {
              setNewSection(e.target.value);
              setSectionError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                makeSection();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="edit ghost"
          disabled={!newSection.trim()}
          onClick={makeSection}
        >
          Add section
        </button>
        <p className="prepsectionnote" role={sectionError ? 'alert' : undefined}>
          {sectionError ??
            'Call them whatever you like. Nothing has to be in a section, and anything filed under Before you go is an errand rather than a thing in the bag.'}
        </p>
      </div>

      <form
        className="prepform"
        onSubmit={(e) => {
          e.preventDefault();
          const spot = parseSpot(into);
          checklist.add(spot.kind, text, spot.name);
          // The section is deliberately kept and the item is not: filling one
          // section means adding six things to it in a row.
          setText('');
        }}
      >
        <label className="prepwhat">
          <span className="eyebrow">Add</span>
          <input
            className="field"
            value={text}
            placeholder="Passport"
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label className="prepgroup">
          <span className="eyebrow">Section</span>
          <select className="field" value={into} onChange={(e) => setInto(e.target.value)}>
            {spots.map((spot) => (
              <option key={spot.value} value={spot.value}>
                {spot.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="edit" disabled={!text.trim()}>
          Add
        </button>
      </form>

      {blocks.length === 0 ? (
        <p className="prepempty">
          Nothing on this list yet. Make a section if it helps, or just start typing things: an
          item with no section sits at the bottom under Everything else, and one filed under
          Before you go sits with the errands.
        </p>
      ) : (
        <>
          {/*
            The sections flow across the width rather than down it: Luggage
            beside Skincare, Carry on beside Haircare, and Before you go among
            them. Six short sections stacked is a page of half empty lines, and
            the whole list is meant to be taken in at a glance.
          */}
          <div className="prepgroups">
            {blocks.map((block) => (
              <SectionBlock key={block.key} block={block} spots={spots} checklist={checklist} />
            ))}
          </div>

          {at.total > 0 && (
            <div className="prepactions">
              <span className="prepcount">
                {at.done} of {at.total} ticked
              </span>
              {at.done > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => LIST_KINDS.forEach((kind) => checklist.resetKind(kind))}
                  >
                    Untick all
                  </button>
                  {/*
                    Two different endings, and they are not the same one. Untick
                    keeps the list for the next trip; Clear ticked throws away
                    what is done and keeps what is not, which is what you want
                    when the list was for this trip only.
                  */}
                  <button
                    type="button"
                    onClick={() => LIST_KINDS.forEach((kind) => checklist.clearDone(kind))}
                  >
                    Clear ticked
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SectionBlock({
  block,
  spots,
  checklist,
}: {
  block: Block;
  spots: { value: string; label: string }[];
  checklist: ChecklistStore;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const { section, items } = block;
  const at = progress(items);
  // A heading rebuilt from what the items carry, rather than a section made
  // here, has nothing stored to rename or remove. Shown without those two
  // controls rather than with a pair that would silently do nothing.
  const editable = section !== null && !isFoundSection(section);

  /**
   * Move one item to a spot, which may be in the other kind: dragging a
   * forgotten errand out of Carry on bag and into Before you go is the same
   * gesture as moving it between two bags, and it should not need to be a
   * different one. The kind goes first so the section name lands on an item
   * that is already in the list it names.
   */
  function moveTo(item: ChecklistItem, value: string) {
    const spot = parseSpot(value);
    if (spot.kind !== item.kind) checklist.update(item.id, { kind: spot.kind });
    checklist.fileUnder(item.id, spot.name);
  }

  return (
    <div className="prepgroupblock">
      <h3>
        {renaming !== null && section ? (
          <input
            className="field prepnamefield"
            value={renaming}
            autoFocus
            maxLength={SECTION_NAME_MAX}
            aria-label="Section name"
            onChange={(e) => setRenaming(e.target.value)}
            onBlur={() => {
              checklist.renameSection(section.id, renaming);
              setRenaming(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                checklist.renameSection(section.id, renaming);
                setRenaming(null);
              }
              if (e.key === 'Escape') setRenaming(null);
            }}
          />
        ) : (
          <span className="prepname">{block.title}</span>
        )}

        {editable && renaming === null && (
          <span className="prepsectionedit">
            <button type="button" onClick={() => setRenaming(section.name)}>
              Rename
            </button>
            <button
              type="button"
              onClick={() => checklist.removeSection(section.id)}
              title="What is in it stays, and becomes unfiled"
            >
              Remove
            </button>
          </span>
        )}

        <span className="prepgroupcount">
          {at.done} of {at.total}
        </span>
      </h3>

      {items.length === 0 ? (
        <p className="prepsectionempty">
          Nothing in here yet. Pick it in the Section box above and add something.
        </p>
      ) : (
        <ul className="preplist">
          {items.map((item) => (
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
              {/* Moving one thing between sections without retyping it. */}
              <select
                className="prepmove"
                value={spotValue(item.kind, item.group ?? '')}
                aria-label={`Which section ${item.text} is in`}
                onChange={(e) => moveTo(item, e.target.value)}
              >
                {spots.map((spot) => (
                  <option key={spot.value} value={spot.value}>
                    {spot.label}
                  </option>
                ))}
              </select>
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
      )}
    </div>
  );
}
