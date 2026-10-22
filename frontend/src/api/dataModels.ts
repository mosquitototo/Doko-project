import { api } from "./client";
import { ensureCsrf } from "./auth";

export type SeverityItem = {
  id: number;
  code: string;
  label: string;
  order: number;
  is_active: boolean;
  color?: string;
};

export type ClassificationItem = {
  id: number;
  code: string;
  label: string;
  is_active: boolean;
};

async function listAllDataModels<T>(path: string, includeInactive: boolean): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  while (true) {
    const { data } = await api.get(path, {
      params: { page, ...(includeInactive ? { include_inactive: "1" } : {}) },
    });
    if (Array.isArray(data)) return [...items, ...data];
    items.push(...(data.results ?? []));
    if (!data.next) return items;
    page += 1;
  }
}

export function listSeverities(includeInactive = false): Promise<SeverityItem[]> {
  return listAllDataModels("/api/settings/data-models/severities/", includeInactive);
}

export async function createSeverity(payload: { code: string; label: string; order: number; color?: string }) {
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
  payload: Partial<{ code: string; label: string; order: number; is_active: boolean; color: string }>
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

export function listClassifications(includeInactive = false): Promise<ClassificationItem[]> {
  return listAllDataModels("/api/settings/data-models/classifications/", includeInactive);
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
