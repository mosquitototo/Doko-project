import { api } from "./client";
import { ensureCsrf } from "./auth";

export type AlertListItem = {
  id: string;
  title: string;
  classification: string;
  severity: string;
  status: string;
  outcome?: string | null;
  created_at: string;
  description: string;
  customer?: string | null;
  customer_name?: string | null;
  owner?: number | null;
  owner_id?: number | null;
  owner_username?: string | null;
  case_number?: number | null;
  sla_due_at?: string | null;
  sla_state?: "none" | "ok" | "overdue" | "completed" | string | null;
  sla_rule?: {
    value: number;
    unit: "minute" | "hour" | "day" | "week" | "month";
  } | null;
};

export type AlertDetailRow = {
  field?: string;
  value?: string;
  status?: string;
};

export type AlertDetail = AlertListItem & {
  source: string;
  iocs: AlertDetailRow[];
  assets: AlertDetailRow[];
  case?: string | null;
  sla_due_at?: string | null;
  sla_state?: "none" | "ok" | "overdue" | "completed" | string | null;
  sla_rule?: {
    value: number;
    unit: "minute" | "hour" | "day" | "week" | "month";
  } | null;
};

export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export async function fetchAlerts(params: {
  page?: number;
  search?: string;
  status?: string[];
  severity?: string[];
  classification?: string[];
  outcome?: string[];
  owner?: string[];
  customer?: string[];
  page_size?: number;
  ordering?: string;
} = {}): Promise<Paginated<AlertListItem>> {
  const res = await api.get("/api/alerts/", {
    params: {
      page: params.page || undefined,
      page_size: params.page_size || undefined,
      search: params.search || undefined,
      status: params.status?.length ? params.status : undefined,
      severity: params.severity?.length ? params.severity : undefined,
      classification: params.classification?.length ? params.classification : undefined,
      outcome: params.outcome?.length ? params.outcome : undefined,
      owner: params.owner?.length ? params.owner : undefined,
      customer: params.customer?.length ? params.customer : undefined,
      ordering: params.ordering || undefined,
    },
    paramsSerializer: {
      indexes: null,
    } as any,
  });

  return Array.isArray(res.data)
    ? { count: res.data.length, next: null, previous: null, results: res.data }
    : res.data;
}

export async function fetchAlertDetail(id: string): Promise<AlertDetail> {
  const res = await api.get(`/api/alerts/${id}/`);
  return res.data;
}

export async function updateAlert(
  id: string,
  payload: Partial<{
    title: string;
    description: string;
    status: string;
    severity: string;
    classification: string;
    outcome: string;
    customer: string | null;
    owner: number | null;
    iocs: any;
    assets: any;
  }>
) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/alerts/${id}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}