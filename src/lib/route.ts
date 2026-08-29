import { useEffect, useState } from 'react';

export type Route = 'sheet' | 'build';

/**
 * Two pages, one stored trip. A hash keeps them separate without a router and
 * without a server, and keeps the builder out of the way of the sheet, which is
 * the page you actually read on the trip.
 */
export function routeOf(hash: string): Route {
  return hash.replace(/^#\/?/, '').startsWith('build') ? 'build' : 'sheet';
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => routeOf(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(routeOf(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (next: Route) => {
    window.location.hash = next === 'build' ? '#/build' : '#/';
    setRoute(next);
    window.scrollTo({ top: 0 });
  };

  return [route, go];
}
