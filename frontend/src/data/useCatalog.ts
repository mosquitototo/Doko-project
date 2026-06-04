import { useCallback, useEffect, useState } from "react";
import { clearCatalogCache, getCatalog } from "./catalog";

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

    setLoading(true);
    getCatalog()
      .then((c) => {
        if (mounted) setCatalog(c);
      })
      .catch(() => {
        if (mounted) setCatalog(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return { loading, catalog, refresh };
}