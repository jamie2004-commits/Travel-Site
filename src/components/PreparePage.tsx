import { useState } from 'react';
import type { Itinerary } from '../types';
import {
  LIST_BLURBS,
  LIST_KINDS,
  LIST_LABELS,
  SECTION_NAME_MAX,
  groupItems,
  isFoundSection,
  itemsOfKind,
  progress,
  sectionsOfKind,
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

export default function PreparePage({
  itinerary,
  checklist,
  onSheet,
  onEdit,
  onActivities,
  onExpenses,
}: Props) {
  return (
    <div className="sheet prepsheet">
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
                  <dd>{at.total ? `${at.done} of ${at.total}` : 'Nothing yet'}</dd>
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
          <ListBlock key={kind} kind={kind} checklist={checklist} />
        ))}
      </main>

      <footer>Safe travels</footer>
    </div>
  );
}

function ListBlock({ kind, checklist }: { kind: ListKind; checklist: ChecklistStore }) {
  const [text, setText] = useState('');
  /** The section the add form files into. '' is no section, which is allowed. */
  const [into, setInto] = useState('');
  const [newSection, setNewSection] = useState('');
  const [sectionError, setSectionError] = useState<string | null>(null);

  const mine = itemsOfKind(checklist.items, kind);
  const own = sectionsOfKind(checklist.sections, kind);
  const groups = groupItems(mine, own);
  const at = progress(mine);

  // Everything that can be filed into: the sections made here, plus any name
  // that arrived on an item from another device.
  const names = groups.map((g) => g.section?.name).filter((n): n is string => !!n);

  function makeSection() {
    const name = newSection.trim();
    if (!name) return;
    if (!checklist.addSection(kind, name)) {
      setSectionError(`There is already a section called ${name}.`);
      return;
    }
    setSectionError(null);
    setNewSection('');
    // Selected straight away, because making a section is something you do in
    // order to put the next thing into it.
    setInto(name);
  }

  return (
    <section className="prep" id={kind} data-kind={kind}>
      <h2>
        {LIST_LABELS[kind]}
        <span className="en">{LIST_BLURBS[kind]}</span>
      </h2>

      <div className="prepsections">
        <label className="prepnewsection">
          <span className="eyebrow">New section</span>
          <input
            className="field"
            value={newSection}
            placeholder={kind === 'packing' ? 'Carry on bag' : 'The night before'}
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
          {sectionError ?? 'Call them whatever you like. Nothing has to be in a section.'}
        </p>
      </div>

      <form
        className="prepform"
        onSubmit={(e) => {
          e.preventDefault();
          checklist.add(kind, text, into);
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
            placeholder={kind === 'packing' ? 'Passport' : 'Tell the bank about the trip'}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label className="prepgroup">
          <span className="eyebrow">Section</span>
          <select className="field" value={into} onChange={(e) => setInto(e.target.value)}>
            <option value="">No section</option>
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="edit" disabled={!text.trim()}>
          Add
        </button>
      </form>

      {groups.length === 0 ? (
        <p className="prepempty">
          Nothing on this list yet. Make a section if it helps, or just start typing things: an
          item with no section sits at the bottom under Everything else.
        </p>
      ) : (
        <>
          {/*
            The sections flow across the width rather than down it: Luggage
            beside Skincare, Carry on beside Haircare. Six short sections
            stacked is a page of half empty lines, and the whole list is meant
            to be taken in at a glance.
          */}
          <div className="prepgroups">
            {groups.map((group) => (
              <SectionBlock
                key={group.section ? group.section.id : '__loose'}
                section={group.section}
                items={group.items}
                names={names}
                checklist={checklist}
              />
            ))}
          </div>

          {at.total > 0 && (
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
          )}
        </>
      )}
    </section>
  );
}

function SectionBlock({
  section,
  items,
  names,
  checklist,
}: {
  section: ChecklistSection | null;
  items: ChecklistItem[];
  names: string[];
  checklist: ChecklistStore;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const at = progress(items);
  // A heading rebuilt from what the items carry, rather than a section made
  // here, has nothing stored to rename or remove. Shown without those two
  // controls rather than with a pair that would silently do nothing.
  const editable = section !== null && !isFoundSection(section);

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
          <span className="prepname">{section ? section.name : 'Everything else'}</span>
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
                value={item.group ?? ''}
                aria-label={`Which section ${item.text} is in`}
                onChange={(e) => checklist.fileUnder(item.id, e.target.value)}
              >
                <option value="">No section</option>
                {names.map((name) => (
                  <option key={name} value={name}>
                    {name}
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
