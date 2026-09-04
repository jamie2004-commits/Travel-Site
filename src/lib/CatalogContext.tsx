import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Place } from '../types';
import { buildCatalog, emptyCatalog, type Catalog } from './catalog';
import { bundledCatalog, loadCatalog } from './catalogSource';
import { loadUserPlaces, saveUserPlaces } from './userPlaces';
import { insertPlace } from './placeWrites';
import { supabase } from './supabase';

interface CatalogValue {
  catalog: Catalog;
  loading: boolean;
  /** Set when Supabase was configured but unreadable, so the UI can say so. */
  error?: string;
  /**
   * Writes to Supabase when signed in, and falls back to this browser
   * otherwise. The result says which happened, so the caller can report it.
   */
  addPlace: (place: Place) => Promise<{ ok: boolean; message: string; stored: 'supabase' | 'browser' }>;
  removePlace: (id: string) => void;
  /** Re-reads the catalog after a write, so a new place appears for real. */
  refresh: () => Promise<void>;
}

const CatalogContext = createContext<CatalogValue>({
  catalog: emptyCatalog,
  loading: true,
  addPlace: async () => ({ ok: false, message: 'Catalog not ready.', stored: 'browser' }),
  removePlace: () => {},
  refresh: async () => {},
});

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [remote, setRemote] = useState<Catalog>(bundledCatalog);
  const [userPlaces, setUserPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  /**
   * Set when the places saved in this browser could not be read. Adding or
   * removing one would then write a list built from nothing over whatever is
   * actually on disk, so both are refused while this is true.
   */
  const [placesUnreadable, setPlacesUnreadable] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([loadCatalog(), loadUserPlaces()]).then(([result, mine]) => {
      if (!live) return;
      setRemote(result.catalog);
      setError(result.error);
      // null means the read failed, which is not an empty list.
      setPlacesUnreadable(mine === null);
      setUserPlaces(mine ?? []);
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

  const refresh = useCallback(async () => {
    const result = await loadCatalog();
    setRemote(result.catalog);
    setError(result.error);
  }, []);

  const addPlace = useCallback<CatalogValue['addPlace']>(
    async (place) => {
      // With a session, the catalog itself is the right home: the place is
      // then on every device, not just this browser.
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          const result = await insertPlace(place);
          if (result.ok) await refresh();
          return { ...result, stored: 'supabase' as const };
        }
      }

      if (placesUnreadable) {
        return {
          ok: false,
          message: 'This browser will not let saved places be read, so a new one cannot be added.',
          stored: 'browser' as const,
        };
      }

      setUserPlaces((current) => {
        const next = [...current, place];
        void saveUserPlaces(next);
        return next;
      });
      return {
        ok: true,
        message: `Added ${place.nameEn || place.nameZh}`,
        stored: 'browser' as const,
      };
    },
    [refresh, placesUnreadable],
  );

  const removePlace = useCallback(
    (id: string) => {
      // Removing from a list we could not read would write that short list
      // over the real one, which is a delete of everything rather than of one.
      if (placesUnreadable) return;
      setUserPlaces((current) => {
        const next = current.filter((p) => p.id !== id);
        void saveUserPlaces(next);
        return next;
      });
    },
    [placesUnreadable],
  );

  const value = useMemo(
    () => ({ catalog, loading, error, addPlace, removePlace, refresh }),
    [catalog, loading, error, addPlace, removePlace, refresh],
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  return useContext(CatalogContext);
}
