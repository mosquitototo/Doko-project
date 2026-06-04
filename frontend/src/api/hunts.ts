import { api } from "./client";
import { ensureCsrf } from "./auth";

export type HuntListItem = {
  id: string;
  title: string;
  context?: string;
  status: string;
  verdict: string;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;

  owner_id_read?: number | null;
  owner_username?: string | null;

  customer?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;

  reviewers_usernames?: string[];
  investigation_started_at?: string | null;
  investigation_finished_at?: string | null;
  search_timeframe_start?: string | null;
  search_timeframe_end?: string | null;
};

export type HuntRow = {
  field?: string;
  value?: string;
  status?: string;
};

export type HuntJournalEntry = {
  id: string;
  entry_type: string;
  text: string;
  author?: number | null;
  author_username?: string | null;
  occurred_at: string;
  linked_ioc_value?: string;
  linked_asset_value?: string;
  linked_action_run_id?: string;
  created_at: string;
  updated_at: string;
};

export type HuntCaseLink = {
  id: string;
  link_type: string;
  created_at: string;
  case?: {
    id: string;
    case_number?: number | null;
    title: string;
    status: string;
    created_at: string;
    updated_at: string;
  };
};

export type HuntDetail = {
  id: string;
  title: string;
  context: string;
  conclusion: string;
  status: string;
  verdict: string;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;

  owner_id_read?: number | null;
  owner_username?: string | null;
  reviewer_ids?: number[];
  reviewers_usernames?: string[];

  customer?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;

  investigation_started_at?: string | null;
  investigation_finished_at?: string | null;
  search_timeframe_start?: string | null;
  search_timeframe_end?: string | null;

  iocs?: HuntRow[];
  assets?: HuntRow[];

  journal_entries?: HuntJournalEntry[];
  case_links?: HuntCaseLink[];
};

export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type HuntTimelineItem = {
  id: string;
  kind: string;
  occurred_at: string;
  title: string;
  details: string;
  author_username?: string | null;
  linked_ioc_value?: string;
  linked_asset_value?: string;
  linked_action_run_id?: string;
  case_id?: string;
  case_title?: string;
  case_number?: number | null;
};

export async function fetchHunts(params: {
  page?: number;
  page_size?: number;
  search?: string;
  status?: string | string[];
  verdict?: string | string[];
  owner?: string | string[];
  customer?: string | string[];
  ordering?: string;
  include_archived?: string;
}): Promise<Paginated<HuntListItem>> {
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
  addMulti("verdict", params.verdict);
  addMulti("owner", params.owner);
  addMulti("customer", params.customer);

  const res = await api.get(`/api/hunts/?${sp.toString()}`);
  return res.data;
}

export async function fetchHuntDetail(id: string): Promise<HuntDetail> {
  const res = await api.get(`/api/hunts/${id}/`);
  return res.data;
}

export async function createHunt(payload: Partial<HuntDetail>) {
  const csrfToken = await ensureCsrf();
  const res = await api.post(`/api/hunts/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data as { id: string };
}

export async function updateHunt(id: string, payload: Partial<HuntDetail>) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/hunts/${id}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function deleteHunt(id: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.post(
    `/api/hunts/${id}/delete/`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
}

export async function listHuntJournal(huntId: string): Promise<HuntJournalEntry[]> {
  const res = await api.get(`/api/hunts/${huntId}/journal/`);
  return Array.isArray(res.data) ? res.data : res.data.results ?? [];
}

export async function createHuntJournalEntry(
  huntId: string,
  payload: {
    entry_type: string;
    text: string;
    occurred_at?: string;
    linked_ioc_value?: string;
    linked_asset_value?: string;
    linked_action_run_id?: string;
  }
): Promise<HuntJournalEntry> {
  const csrfToken = await ensureCsrf();
  const res = await api.post(`/api/hunts/${huntId}/journal/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function updateHuntJournalEntry(id: string, payload: Partial<HuntJournalEntry>) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/hunt-journal/${id}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function deleteHuntJournalEntry(id: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/hunt-journal/${id}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function listHuntCaseLinks(huntId: string): Promise<HuntCaseLink[]> {
  const res = await api.get(`/api/hunts/${huntId}/case-links/`);
  return Array.isArray(res.data) ? res.data : res.data.results ?? [];
}

export async function createHuntCaseLink(
  huntId: string,
  payload: { case_id: string; link_type?: string }
): Promise<HuntCaseLink> {
  const csrfToken = await ensureCsrf();
  const res = await api.post(`/api/hunts/${huntId}/case-links/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function deleteHuntCaseLink(id: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/hunt-case-links/${id}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function listHuntTimeline(huntId: string): Promise<HuntTimelineItem[]> {
  const res = await api.get(`/api/hunts/${huntId}/timeline/`);
  return Array.isArray(res.data) ? res.data : res.data.results ?? [];
}

export async function archiveHunt(id: string) {
  const csrfToken = await ensureCsrf();
  const { data } = await api.post(
    `/api/hunts/${id}/archive/`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return data;
}

export async function unarchiveHunt(id: string) {
  const csrfToken = await ensureCsrf();
  const { data } = await api.post(
    `/api/hunts/${id}/unarchive/`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return data;
}