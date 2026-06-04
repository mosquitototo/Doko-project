import { api } from "./client";
import { ensureCsrf } from "./auth";

export type DashboardQueryParams = {
  customer?: string;
  period?: "last_7d" | "last_30d" | "last_90d" | "since" | "between" | "all";
  date_from?: string;
  date_to?: string;
};

export async function fetchDashboard(params?: DashboardQueryParams): Promise<any> {
  const qs = new URLSearchParams();

  if (params?.customer) qs.set("customer", params.customer);
  if (params?.period) qs.set("period", params.period);
  if (params?.date_from) qs.set("date_from", params.date_from);
  if (params?.date_to) qs.set("date_to", params.date_to);

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await api.get(`/api/dashboard/${suffix}`);
  return res.data as any;
}

export async function fetchDashboardPreferences(): Promise<any> {
  const res = await api.get("/api/dashboard/preferences/");
  return res.data as any;
}

export async function updateDashboardPreferences(payload: any) {
  const csrfToken = await ensureCsrf();
  const res = await api.put("/api/dashboard/preferences/", payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function resetDashboardPreferences(): Promise<any> {
  const csrfToken = await ensureCsrf();
  const res = await api.delete("/api/dashboard/preferences/", {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data as any;
}