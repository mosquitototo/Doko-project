import { api } from "./client";
import { ensureCsrf } from "./auth";

export type ReportTemplate = {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
  html?: string;
  css?: string;
  version: number;
  created_at?: string;
  updated_at?: string;
};

export async function listReportTemplates(params: { q?: string; include_inactive?: boolean } = {}) {
  const res = await api.get("/api/settings/report-templates/", {
    params: {
      q: params.q || undefined,
      include_inactive: params.include_inactive ? "1" : undefined,
    },
  });
  return Array.isArray(res.data) ? { results: res.data, count: res.data.length } : res.data;
}

export async function getReportTemplate(id: string): Promise<ReportTemplate> {
  const res = await api.get(`/api/settings/report-templates/${id}/`);
  return res.data;
}

export async function createReportTemplate(payload: Partial<ReportTemplate>): Promise<ReportTemplate> {
  const csrfToken = await ensureCsrf();
  const res = await api.post(`/api/settings/report-templates/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function updateReportTemplate(id: string, payload: Partial<ReportTemplate>): Promise<ReportTemplate> {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/settings/report-templates/${id}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function deleteReportTemplate(id: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/settings/report-templates/${id}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function previewReportTemplate(payload: {
  case_id: string;
  html: string;
  css?: string;
  params?: any;
}) {
  const csrfToken = await ensureCsrf();
  const res = await api.post(`/api/settings/report-templates/preview/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data as { html: string; css: string };
}