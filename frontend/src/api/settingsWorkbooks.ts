import { api } from "./client";
import { ensureCsrf } from "./auth";

export type WorkbookTemplateItem = {
  id: string;
  label: string;
  order: number;
};

export type WorkbookTemplate = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

export async function listWorkbookTemplates(params: { q?: string; include_inactive?: boolean } = {}) {
  const res = await api.get(`/api/settings/workbook-templates/`, {
    params: {
      q: params.q || undefined,
      include_inactive: params.include_inactive ? "1" : undefined,
    },
  });
  return Array.isArray(res.data) ? { results: res.data, count: res.data.length } : res.data;
}

export async function createWorkbookTemplate(payload: { name: string }) {
  const csrfToken = await ensureCsrf();
  const res = await api.post(`/api/settings/workbook-templates/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function patchWorkbookTemplate(id: string, payload: Partial<{ name: string; is_active: boolean }>) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/settings/workbook-templates/${id}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function deleteWorkbookTemplate(id: string) {
  const csrfToken = await ensureCsrf();
  const res = await api.delete(`/api/settings/workbook-templates/${id}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function listWorkbookTemplateItems(templateId: string) {
  const res = await api.get(`/api/settings/workbook-templates/${templateId}/items/`);
  return Array.isArray(res.data) ? { results: res.data, count: res.data.length } : res.data;
}

export async function createWorkbookTemplateItem(templateId: string, payload: { label: string; order?: number }) {
  const csrfToken = await ensureCsrf();
  const res = await api.post(`/api/settings/workbook-templates/${templateId}/items/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function patchWorkbookTemplateItem(itemId: string, payload: Partial<{ label: string; order: number }>) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/settings/workbook-template-items/${itemId}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function deleteWorkbookTemplateItem(itemId: string) {
  const csrfToken = await ensureCsrf();
  const res = await api.delete(`/api/settings/workbook-template-items/${itemId}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}