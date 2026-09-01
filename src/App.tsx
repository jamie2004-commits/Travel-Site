import { useEffect, useState } from 'react';
import StartDialog from './components/StartDialog';
import { starterItinerary } from './data/starterItinerary';
import { useItinerary } from './lib/store';
import { CatalogProvider } from './lib/CatalogContext';
import ItineraryView from './components/ItineraryView';
import ActivitiesPage from './components/ActivitiesPage';
import EditPage from './components/EditPage';
import ExpensesPage from './components/ExpensesPage';
import { useRoute } from './lib/route';

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
      {route === 'edit' && (
        <EditPage
          trip={trip}
          onSheet={() => go('sheet')}
          onActivities={() => go('activities')}
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
        />
      )}
      {route === 'expenses' && (
        <ExpensesPage
          itinerary={trip.state.itinerary}
          onSheet={() => go('sheet')}
          onEdit={() => go('edit')}
          onActivities={() => go('activities')}
        />
      )}
      {route === 'sheet' && (
        <ItineraryView
          itinerary={trip.state.itinerary}
          onEdit={() => go('edit')}
          onActivities={() => go('activities')}
          onExpenses={() => go('expenses')}
        />
      )}

      {trip.needsStart && (
        <StartDialog
          sampleDays={starterItinerary.days.length}
          sampleItems={starterItinerary.days.reduce((n, d) => n + d.items.length, 0)}
          onPick={trip.start}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <CatalogProvider>
      <Pages />
    </CatalogProvider>
  );
}
