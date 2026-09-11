import { useEffect, useState } from 'react';
import StartDialog from './components/StartDialog';
import { starterItinerary } from './data/starterItinerary';
import { useItinerary } from './lib/store';
import { CatalogProvider } from './lib/CatalogContext';
import { IdentityProvider } from './lib/IdentityContext';
import ItineraryView from './components/ItineraryView';
import ActivitiesPage from './components/ActivitiesPage';
import EditPage from './components/EditPage';
import ExpensesPage from './components/ExpensesPage';
import PreparePage from './components/PreparePage';
import { useRoute } from './lib/route';
import { useChecklist } from './lib/checklist';
import { useTripSync } from './lib/tripSync';
import SyncBar from './components/SyncBar';
import TripsDialog from './components/TripsDialog';
import AccountDialog from './components/AccountDialog';
import { useExpenses } from './lib/expenses';

/**
 * Four pages over one stored trip: the sheet you read, the editor you change
 * it in, the activities page you browse, and the expenses page where what the
 * trip really cost is recorded. They were one screen, which meant
 * the itinerary was only ever visible as half a window with a library beside
 * it, and a thing to do was three lines in a column narrower than this
 * sentence. Each is now a page of its own, and this is all that is left here.
 *
 * The day being filled lives here rather than in any one page, so browsing
 * activities and adding to the trip are the same act, and coming back to the
 * editor lands on the day you were just adding to.
 */
function Pages() {
  const trip = useItinerary();
  const [route, go] = useRoute();
  const [activeDayId, setActiveDayId] = useState<string | null>(null);
  const days = trip.state.itinerary.days;
  /**
   * Which of the two account dialogs is up, if either. One piece of state
   * rather than two booleans, because they are alternatives: the trip list
   * hands off to the account dialog when the reason the list is short is that
   * this browser has no account, and both being open at once is not a state.
   */
  const [dialog, setDialog] = useState<'trips' | 'account' | null>(null);
  /**
   * Held here rather than on the expenses page, because this hook is also what
   * pushes the ledger to the server, and that has to happen wherever you are.
   * Owned by the page that shows the ledger, it only pushed while that page was
   * open: a restored ledger sat in the browser until somebody clicked Expenses.
   */
  const ledger = useExpenses();
  /**
   * Held here for the reason the ledger is: the read happens once, so moving
   * between pages does not flash an empty list at somebody halfway through
   * packing. It has no server half yet, so unlike the ledger there is nothing
   * here that has to keep running while another page is open.
   */
  const checklist = useChecklist();

  /**
   * Kept on the server, in the background.
   *
   * Both halves of the gate matter, and `storage === 'ready'` alone is not
   * enough: the store sets `ready` and `needsStart` at the same instant on a
   * first visit, so a browser with empty storage passes the first test while
   * the reducer is still holding `emptyItinerary()`. Sync would then push that
   * empty trip over a real one on the server, and the compare and swap would
   * accept it, because nothing about it looks like a conflict.
   *
   * The local write-through has always guarded both. This is the same guard.
   */
  const sync = useTripSync(
    trip.state.itinerary,
    trip.dispatch,
    trip.storage === 'ready' && !trip.needsStart,
  );

  useEffect(() => {
    if (!days.length) {
      if (activeDayId !== null) setActiveDayId(null);
      return;
    }
    if (!days.some((d) => d.id === activeDayId)) setActiveDayId(days[0].id);
  }, [days, activeDayId]);

  if (!trip.loaded) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: 'var(--bg)' }}>
        <p className="eyebrow">Loading</p>
      </div>
    );
  }

  return (
    <>
      {/*
        The stored trip could not be read, so there may be one on disk that this
        browser cannot see. Nothing is being saved, because saving now would
        write this empty trip over it. Said plainly and left on screen, because
        the alternative is someone planning a day into a page that forgets it.
      */}
      {trip.storage === 'failed' && (
        <div className="storage-warning" role="alert">
          <b>This browser will not let the trip be saved.</b> Anything changed here is lost on
          reload, and a trip already saved in this browser cannot be read. Private browsing and
          blocked site data are the usual causes.
        </div>
      )}
      {route === 'edit' && (
        <EditPage
          trip={trip}
          ledger={{ expenses: ledger.expenses, rate: ledger.rate }}
          onSheet={() => go('sheet')}
          onActivities={() => go('activities')}
          onTrips={() => setDialog('trips')}
          activeDayId={activeDayId}
          setActiveDayId={setActiveDayId}
        />
      )}
      {route === 'activities' && (
        <ActivitiesPage
          days={days}
          activeDayId={activeDayId}
          onSelectDay={setActiveDayId}
          onAdd={(place, dayId) => {
            trip.dispatch({ type: 'addPlace', dayId, place });
            setActiveDayId(dayId);
          }}
          usage={trip.usage}
          onBuild={() => go('edit')}
          onSheet={() => go('sheet')}
          onPlaceDeleted={(place) =>
            trip.dispatch({
              type: 'detachPlace',
              placeId: place.id,
              title: place.nameZh || place.nameEn,
            })
          }
        />
      )}
      {route === 'prepare' && (
        <PreparePage
          itinerary={trip.state.itinerary}
          checklist={checklist}
          onSheet={() => go('sheet')}
          onEdit={() => go('edit')}
          onActivities={() => go('activities')}
          onExpenses={() => go('expenses')}
        />
      )}
      {route === 'expenses' && (
        <ExpensesPage
          ledger={ledger}
          itinerary={trip.state.itinerary}
          onSheet={() => go('sheet')}
          onEdit={() => go('edit')}
          onActivities={() => go('activities')}
        />
      )}
      {route === 'sheet' && (
        <ItineraryView
          itinerary={trip.state.itinerary}
          ledger={{ expenses: ledger.expenses, rate: ledger.rate }}
          onEdit={() => go('edit')}
          onActivities={() => go('activities')}
          onExpenses={() => go('expenses')}
          onPrepare={() => go('prepare')}
          onTrips={() => setDialog('trips')}
          onAccount={() => setDialog('account')}
        />
      )}

      <SyncBar sync={sync} />

      {trip.needsStart && (
        <StartDialog
          sampleDays={starterItinerary.days.length}
          sampleItems={starterItinerary.days.reduce((n, d) => n + d.items.length, 0)}
          onPick={trip.start}
          onSignIn={() => setDialog('account')}
        />
      )}

      {dialog === 'trips' && (
        <TripsDialog
          current={trip.state.itinerary}
          onClose={() => setDialog(null)}
          onSignIn={() => setDialog('account')}
        />
      )}

      {dialog === 'account' && <AccountDialog onClose={() => setDialog(null)} />}

    </>
  );
}

export default function App() {
  return (
    // Identity outermost: the catalog's writes stamp created_by with it, and
    // the library reads it to decide whether to draw a delete control.
    <IdentityProvider>
      <CatalogProvider>
        <Pages />
      </CatalogProvider>
    </IdentityProvider>
  );
}
