import { api } from "./client";
import { ensureCsrf } from "./auth";

export type EventListItem = {
  id: string;
  case_number?: number | null;
  title: string;
  description?: string | null;

  status: string;
  updated_at: string;
  created_at?: string;
  archived_at?: string | null;

  classification?: string | null;
  severity?: string | null;
  outcome?: string | null;

  owner_id_read?: number | null;
  owner_username?: string | null;
  customer?: string | null;
  customer_name?: string | null;

  has_recent_activity?: boolean;
  recent_activity_at?: string | null;
  recent_activity_kind?: "comment" | "inbound_exchange" | "auto_followup" | null;
  last_viewed_at?: string | null;

  auto_followup_enabled?: boolean;
  auto_followup_delay_value?: number;
  auto_followup_delay_unit?: "minute" | "hour" | "day" | "week" | "month" | null;
  auto_followup_quickpart_id?: string | null;
  auto_followup_quickpart_name?: string | null;
};

export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};


export async function fetchTickets(params: {
  page?: number;
  page_size?: number;
  search?: string;
  status?: string | string[];
  owner?: string | string[];
  ordering?: string;
  classification?: string | string[];
  severity?: string | string[];
  customer?: string | string[];
  outcome?: string | string[];
  include_archived?: string;
  archived_only?: string;
}): Promise<Paginated<EventListItem>> {
  const sp = new URLSearchParams();

  const add = (k: string, v: any) => {
    if (v === undefined || v === null || v === "") return;
    sp.append(k, String(v));
  };

  const addMulti = (k: string, v: any) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x) => add(k, x));
    else add(k, v);
  };

  add("page", params.page);
  add("page_size", params.page_size);
  add("search", params.search);
  add("ordering", params.ordering);
  add("include_archived", params.include_archived);

  addMulti("status", params.status);
  addMulti("severity", params.severity);
  addMulti("classification", params.classification);
  addMulti("owner", params.owner);
  addMulti("customer", params.customer);
  addMulti("outcome", params.outcome);
  add("archived_only", params.archived_only);

  const res = await api.get(`/api/events/?${sp.toString()}`);
  return res.data;
}


export type CreateCasePayload = {
  title: string;
  description?: string;
  status?: string;

  customer?: string | null; 
  severity?: string; 
  classification?: string; 
  owner_id?: number; 
  case_template_id?: string;
  workbook_template_id?: string;
};

export async function createTicket(payload: CreateCasePayload) {
  const csrfToken = await ensureCsrf();
  const res = await api.post("/api/events/", payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data as { id: string };
}

export async function updateTicket(
  id: string,
  payload: Partial<{
    title: string;
    description: string;
    status: string;
    severity: string;
    classification: string;
    outcome: string;
    customer: string | null;
    owner_id: number | null;
    iocs: any;
    assets: any;
  }>
) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/events/${id}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function deleteCase(caseId: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.post(
    `/api/events/${caseId}/delete/`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
}

export async function archiveCase(caseId: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.post(
    `/api/events/${caseId}/archive/`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
}

export async function unarchiveCase(caseId: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.post(
    `/api/events/${caseId}/unarchive/`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
}

export function applyTemplateOnCreate(eventPayload: any, template: any) {
  const next = { ...(eventPayload || {}) };

  const title = String(next.title || "").trim();
  const prefix = String(template?.title_prefix || "").trim();
  if (prefix) {
    next.title = `${prefix} ${title}`.trim();
  }

  const desc = String(next.description || "").trim();
  const base = String(template?.base_description || "").trim();
  if (base && desc) {
    next.description = `${base}\n\n${desc}`;
  } else if (base && !desc) {
    next.description = base;
  }

  if (!next.severity && template?.default_severity) {
    next.severity = template.default_severity;
  }

  if (!next.classification && template?.default_classification) {
    next.classification = template.default_classification;
  }

  if (!next.owner && template?.default_owner_id) {
    next.owner = template.default_owner_id;
  }

  if (!next.customer && template?.default_customer_id) {
    next.customer = template.default_customer_id;
  }

  if (!next.workbook_template && template?.workbook_template_id) {
    next.workbook_template = template.workbook_template_id;
  }

  return next;
}