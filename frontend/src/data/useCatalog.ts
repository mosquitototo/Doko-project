import { useCallback, useEffect, useState } from "react";
import { CATALOG_CHANGED_EVENT, clearCatalogCache, getCatalog } from "./catalog";

export function useCatalog() {
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof getCatalog>> | null>(null);

  const refresh = useCallback(async ({ clear = false }: { clear?: boolean } = {}) => {
    if (clear) {
      clearCatalogCache();
    }

    setLoading(true);
    try {
      const c = await getCatalog();
      setCatalog(c);
    } catch {
      setCatalog(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let generation = 0;

    const load = () => {
      const current = ++generation;
      setLoading(true);
      getCatalog()
        .then((c) => {
          if (mounted && current === generation) setCatalog(c);
        })
        .catch(() => {
          if (mounted && current === generation) setCatalog(null);
        })
        .finally(() => {
          if (mounted && current === generation) setLoading(false);
        });
    };
    load();
    window.addEventListener(CATALOG_CHANGED_EVENT, load);

    return () => {
      mounted = false;
      window.removeEventListener(CATALOG_CHANGED_EVENT, load);
    };
  }, []);

  return { loading, catalog, refresh };
}
