import { useEffect, useState } from 'react';

export type Route = 'sheet' | 'edit' | 'activities';

/**
 * Three pages, one stored trip. A hash keeps them separate without a router and
 * without a server, and keeps the editor out of the way of the sheet, which is
 * the page you actually read on the trip.
 *
 * `#/build` was the editor's old address, back when it was a builder with a
 * library bolted to its side. Links to it are still in people's history, so it
 * still lands on the editor rather than silently falling through to the sheet.
 */
export function routeOf(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path.startsWith('edit') || path.startsWith('build')) return 'edit';
  if (path.startsWith('activities')) return 'activities';
  return 'sheet';
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => routeOf(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(routeOf(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (next: Route) => {
    window.location.hash = next === 'sheet' ? '#/' : `#/${next}`;
    setRoute(next);
    window.scrollTo({ top: 0 });
  };

  return [route, go];
}
