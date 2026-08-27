import { useCallback, useEffect, useState } from 'react';
import type { City, Place } from './types';
import LibraryPane from './components/LibraryPane';
import ItineraryPane from './components/ItineraryPane';
import DayPicker from './components/DayPicker';
import ConfirmDialog from './components/ConfirmDialog';
import Toast from './components/Toast';
import { useItinerary } from './lib/store';

type Tab = 'browse' | 'trip';

export default function App() {
  const [city, setCity] = useState<City>('hangzhou');
  const [tab, setTab] = useState<Tab>('browse');
  const [pending, setPending] = useState<Place | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { state, dispatch, loaded, usage, canUndo, undoLabel, undo } = useItinerary();
  const days = state.itinerary.days;

  useEffect(() => {
    document.documentElement.dataset.city = city;
  }, [city]);

  const addToDay = useCallback(
    (place: Place, dayId: string) => {
      dispatch({ type: 'addPlace', dayId, place });
      const day = days.find((d) => d.id === dayId);
      setToast(`已加入 ${day?.label ?? ''} · ${place.nameZh}`);
    },
    [dispatch, days],
  );

  // One day means no question to ask. More than one opens the picker.
  const onAdd = useCallback(
    (place: Place) => {
      if (days.length === 1) {
        addToDay(place, days[0].id);
        return;
      }
      if (days.length === 0) {
        dispatch({ type: 'addDay' });
        setToast('先加一天 · Added a day first');
        return;
      }
      setPending(place);
    },
    [days, addToDay, dispatch],
  );

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: 'var(--bg)' }}>
        <p className="eyebrow">Loading</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg)' }}>
      <header
        className="flex shrink-0 items-center gap-3 border-b px-4 py-3"
        style={{ borderColor: 'var(--line)', background: 'var(--mist)' }}
      >
        <div>
          <p className="eyebrow">Itinerary Builder</p>
          <h1 className="zh text-[22px] leading-tight font-black">行程编排</h1>
        </div>
      </header>

      {/* Mobile: two tabs. Desktop: both panes side by side. */}
      <nav
        className="flex shrink-0 border-b md:hidden"
        style={{ borderColor: 'var(--line)' }}
        aria-label="Panes"
      >
        {(
          [
            ['browse', '浏览', 'Browse'],
            ['trip', '我的行程', 'My Trip'],
          ] as [Tab, string, string][]
        ).map(([id, zh, en]) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={active ? 'page' : undefined}
              className="zh flex-1 text-[16px]"
              style={{
                minHeight: 48,
                color: active ? 'var(--ink)' : 'var(--muted)',
                fontWeight: active ? 600 : 400,
                borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                background: active ? 'var(--accent-soft)' : 'transparent',
              }}
            >
              {zh}
              <span className="ml-2 text-[11px]" style={{ fontFamily: 'var(--font-sans)' }}>
                {en}
              </span>
            </button>
          );
        })}
      </nav>

      <main className="grid min-h-0 flex-1 md:grid-cols-2">
        <div
          className={`${tab === 'browse' ? 'flex' : 'hidden'} min-h-0 md:flex md:border-r`}
          style={{ borderColor: 'var(--line)' }}
        >
          <div className="min-h-0 w-full">
            <LibraryPane city={city} onCityChange={setCity} usage={usage} onAdd={onAdd} />
          </div>
        </div>

        <div className={`${tab === 'trip' ? 'flex' : 'hidden'} min-h-0 md:flex`}>
          <div className="min-h-0 w-full">
            <ItineraryPane
              state={state}
              dispatch={dispatch}
              canUndo={canUndo}
              undoLabel={undoLabel}
              onUndo={undo}
              onReset={() => setConfirmReset(true)}
            />
          </div>
        </div>
      </main>

      {pending && (
        <DayPicker
          days={days}
          title={pending.nameZh}
          onPick={(dayId) => {
            addToDay(pending, dayId);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}

      {confirmReset && (
        <ConfirmDialog
          titleZh="清空行程"
          titleEn="Reset the itinerary"
          body="This clears every day and every item and starts again with one empty day. Undo will bring it back."
          confirmLabel="清空 Reset"
          onConfirm={() => {
            dispatch({ type: 'reset' });
            setConfirmReset(false);
            setToast('已清空 · Reset');
          }}
          onCancel={() => setConfirmReset(false)}
        />
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
