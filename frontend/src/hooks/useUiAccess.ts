import { useCallback } from "react";
import { useToast } from "../components/ui/toast";
import { useMe } from "../contexts/MeContext";

function getStatus(error: any): number {
  return Number(error?.response?.status || 0);
}

function getDetail(error: any): string {
  const value =
    error?.response?.data?.detail ??
    error?.response?.data?.error ??
    error?.response?.data?.message ??
    error?.message ??
    "";
  return typeof value === "string" ? value.trim() : "";
}

export function useUiAccess() {
  const { push } = useToast();
  const me = useMe();

  const can = useCallback(
    (perm: string) => !!me?.is_staff || !!me?.permissions?.includes(perm),
    [me]
  );

  const deny = useCallback(
    (action: string) => {
      push({
        kind: "error",
        title: "Access denied",
        message: `You do not have permission to ${action}.`,
      });
    },
    [push]
  );

  const getApiMessage = useCallback((error: any, fallback: string) => {
    const detail = getDetail(error);
    if (detail) return detail;

    const status = getStatus(error);

    if (status === 401) return "Your session has expired. Please sign in again.";
    if (status === 404) return "Resource not found";
    if (status === 409) return "Conflict detected";
    if (!status) return "Error";

    return fallback;
  }, []);

  const handlePassiveLoadError = useCallback(
    (
      error: any,
      options: {
        onForbidden: () => void;
        setError?: (value: string | null) => void;
        fallback?: string;
      }
    ) => {
      const status = getStatus(error);

      if (status === 403) {
        options.onForbidden();
        options.setError?.(null);
        return;
      }

      options.setError?.(
        getApiMessage(error, options.fallback || "Unable to load data.")
      );
    },
    [getApiMessage]
  );

  const handleActionError = useCallback(
    (error: any, action: string, fallback: string) => {
      if (getStatus(error) === 403) {
        deny(action);
        return;
      }

      push({
        kind: "error",
        title: "Error",
        message: getApiMessage(error, fallback),
      });
    },
    [deny, getApiMessage, push]
  );

  const isForbiddenError = useCallback((error: any) => getStatus(error) === 403, []);

  return {
    me,
    push,
    can,
    deny,
    isForbiddenError,
    handlePassiveLoadError,
    handleActionError,
  };
}