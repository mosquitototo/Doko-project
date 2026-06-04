import { api } from "./client";
import { ensureCsrf } from "./auth";

export type SeverityItem = {
  id: number;
  code: string;
  label: string;
  order: number;
  is_active: boolean;
};

export type ClassificationItem = {
  id: number;
  code: string;
  label: string;
  is_active: boolean;
};

export async function listSeverities(includeInactive = false): Promise<SeverityItem[]> {
  const res = await api.get("/api/settings/data-models/severities/", {
    params: includeInactive ? { include_inactive: "1" } : {},
  });
  return Array.isArray(res.data) ? res.data : res.data.results ?? [];
}

export async function createSeverity(payload: { code: string; label: string; order: number }) {
  const csrfToken = await ensureCsrf();
  const res = await api.post("/api/settings/data-models/severities/", payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data as SeverityItem;
}

export async function updateSeverity(
  id: number,
  payload: Partial<{ code: string; label: string; order: number; is_active: boolean }>
) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/settings/data-models/severities/${id}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data as SeverityItem;
}

export async function disableSeverity(id: number) {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/settings/data-models/severities/${id}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function listClassifications(includeInactive = false): Promise<ClassificationItem[]> {
  const res = await api.get("/api/settings/data-models/classifications/", {
    params: includeInactive ? { include_inactive: "1" } : {},
  });
  return Array.isArray(res.data) ? res.data : res.data.results ?? [];
}

export async function createClassification(payload: { code: string; label: string }) {
  const csrfToken = await ensureCsrf();
  const res = await api.post("/api/settings/data-models/classifications/", payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data as ClassificationItem;
}

export async function updateClassification(
  id: number,
  payload: Partial<{ code: string; label: string; is_active: boolean }>
) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/settings/data-models/classifications/${id}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data as ClassificationItem;
}

export async function disableClassification(id: number) {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/settings/data-models/classifications/${id}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}