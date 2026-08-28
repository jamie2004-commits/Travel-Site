import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Place } from '../types';
import { buildCatalog, emptyCatalog, type Catalog } from './catalog';
import { bundledCatalog, loadCatalog } from './catalogSource';
import { loadUserPlaces, saveUserPlaces } from './userPlaces';

interface CatalogValue {
  catalog: Catalog;
  loading: boolean;
  /** Set when Supabase was configured but unreadable, so the UI can say so. */
  error?: string;
  addPlace: (place: Place) => void;
  removePlace: (id: string) => void;
}

const CatalogContext = createContext<CatalogValue>({
  catalog: emptyCatalog,
  loading: true,
  addPlace: () => {},
  removePlace: () => {},
});

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [remote, setRemote] = useState<Catalog>(bundledCatalog);
  const [userPlaces, setUserPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    Promise.all([loadCatalog(), loadUserPlaces()]).then(([result, mine]) => {
      if (!live) return;
      setRemote(result.catalog);
      setError(result.error);
      setUserPlaces(mine);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  // Places added in the app sit on top of whichever catalog was loaded.
  const catalog = useMemo(
    () =>
      userPlaces.length
        ? buildCatalog([...remote.places, ...userPlaces], remote.districts, remote.origin)
        : remote,
    [remote, userPlaces],
  );

  const addPlace = useCallback((place: Place) => {
    setUserPlaces((current) => {
      const next = [...current, place];
      void saveUserPlaces(next);
      return next;
    });
  }, []);

  const removePlace = useCallback((id: string) => {
    setUserPlaces((current) => {
      const next = current.filter((p) => p.id !== id);
      void saveUserPlaces(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ catalog, loading, error, addPlace, removePlace }),
    [catalog, loading, error, addPlace, removePlace],
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  return useContext(CatalogContext);
}
