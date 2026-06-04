import { api } from "./client";
import { ensureCsrf } from "./auth";

export type CaseExchangeQuickpart = {
  id: string;
  name: string;
  description?: string;
  body: string;
  is_active: boolean;
  updated_at?: string;
  created_at?: string;
};

export async function listCaseExchangeQuickparts(
  params: { q?: string; include_inactive?: boolean } = {}
) {
  const r = await api.get("/api/settings/case-exchange-reply-quickparts/", {
    params: {
      q: params.q || undefined,
      include_inactive: params.include_inactive ? "1" : undefined,
    },
  });
  return r.data;
}

export async function getCaseExchangeQuickpart(id: string) {
  const r = await api.get(`/api/settings/case-exchange-reply-quickparts/${id}/`);
  return r.data as CaseExchangeQuickpart;
}

export async function createCaseExchangeQuickpart(payload: Partial<CaseExchangeQuickpart>) {
  const csrfToken = await ensureCsrf();
  const r = await api.post("/api/settings/case-exchange-reply-quickparts/", payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return r.data as CaseExchangeQuickpart;
}

export async function updateCaseExchangeQuickpart(
  id: string,
  payload: Partial<CaseExchangeQuickpart>
) {
  const csrfToken = await ensureCsrf();
  const r = await api.patch(`/api/settings/case-exchange-reply-quickparts/${id}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return r.data as CaseExchangeQuickpart;
}

export async function deleteCaseExchangeQuickpart(id: string) {
  const csrfToken = await ensureCsrf();
  const r = await api.delete(`/api/settings/case-exchange-reply-quickparts/${id}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return r.data;
}