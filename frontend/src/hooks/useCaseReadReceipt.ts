import { useCallback, useEffect, useRef, useState } from "react";
import { markCaseViewed } from "../api/caseDetail";
import { caseActivityVersion, createCaseReadReceipt } from "../utils/caseReadReceipt";

export function useCaseReadReceipt(caseId: string, onError: () => void) {
  const trackerRef = useRef<ReturnType<typeof createCaseReadReceipt> | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const [loaded, setLoaded] = useState<{ caseId: string; cursor: string; version: string } | null>(null);

  useEffect(() => {
    const tracker = createCaseReadReceipt({
      send: cursor => markCaseViewed(caseId, cursor),
      onError: () => errorRef.current(),
    });
    trackerRef.current = tracker;
    return () => {
      tracker.dispose();
      trackerRef.current = null;
    };
  }, [caseId]);

  useEffect(() => {
    if (!loaded || loaded.caseId !== caseId) return;
    const markVisible = () => {
      if (document.visibilityState === "visible") trackerRef.current?.loaded(loaded.cursor, loaded.version);
    };
    markVisible();
    document.addEventListener("visibilitychange", markVisible);
    return () => document.removeEventListener("visibilitychange", markVisible);
  }, [caseId, loaded]);

  return useCallback((cursor: string, comments: { id: string; created_at: string }[], exchanges: { id: string; created_at: string }[]) => {
    setLoaded({ caseId, cursor, version: caseActivityVersion(cursor, comments, exchanges) });
  }, [caseId]);
}
