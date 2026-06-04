import { api } from "./client";
import { ensureCsrf } from "./auth";

export type TimelineItem = {
  id: string;
  date: string;
  type: string;
  text: string;
  actor: number | null;
  actor_username?: string | null;
  created_at: string;
  alert_id?: string | null;
};

export type Comment = {
  id: string;
  text: string;
  author: number;
  author_display?: string
  created_at: string;
};

export type Attachment = {
  id: string;
  original_name: string;
  file_url: string | null;
  created_at: string;
};

export type EventDetailRow = {
  field?: string;
  value?: string;
  status?: string;
};

export type EventDetail = {
  id: string;
  case_number?: number | null;
  title: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
  timeline_items: TimelineItem[];
  comments?: any[];
  customer?: string | null;
  customer_name?: string | null;
  case_sources?: string[];
  owner_id_read?: number | null;
  iocs?: EventDetailRow[];
  assets?: EventDetailRow[];
  auto_followup_enabled?: boolean;
  auto_followup_delay_value?: number;
  auto_followup_delay_unit?: "minute" | "hour" | "day" | "week" | "month" | null;
  auto_followup_quickpart_id?: string | null;
  auto_followup_quickpart_name?: string | null;
};

export type LinkedAlert = {
  id: string;
  title: string;
  status: string;
  severity?: string;
  created_at: string;
  case?: string | null;
};

export async function fetchEventDetail(id: string): Promise<EventDetail> {
  const res = await api.get(`/api/events/${id}/`);
  return res.data;
}

export async function updateEvent(id: string, payload: Partial<EventDetail>) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/events/${id}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function updateEventStatus(id: string, status: string) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(
    `/api/events/${id}/`,
    { status },
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return res.data;
}

export async function listComments(eventId: string): Promise<Comment[]> {
  const res = await api.get(`/api/events/${eventId}/comments/`);
  return Array.isArray(res.data) ? res.data : res.data.results ?? [];
}

export async function addComment(eventId: string, text: string): Promise<Comment> {
  const csrfToken = await ensureCsrf();
  const res = await api.post(
    `/api/events/${eventId}/comments/`,
    { text },
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return res.data;
}

export async function updateComment(commentId: string, text: string) {
  const csrfToken = await ensureCsrf();
  const r = await api.patch(
    `/api/comments/${commentId}/`,
    { text },
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return r.data;
}

export async function deleteComment(commentId: string) {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/comments/${commentId}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function listAttachments(eventId: string): Promise<Attachment[]> {
  const res = await api.get(`/api/events/${eventId}/attachments/`);
  return Array.isArray(res.data) ? res.data : res.data.results ?? [];
}

export async function uploadAttachment(eventId: string, file: File) {
  const csrfToken = await ensureCsrf();
  const form = new FormData();
  form.append("file", file);
  const res = await api.post(`/api/events/${eventId}/attachments/`, form, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function deleteAttachment(attachmentId: string) {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/attachments/${attachmentId}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function listLinkedAlerts(caseId: string): Promise<LinkedAlert[]> {
  const res = await api.get(`/api/events/${caseId}/alerts/`);
  return Array.isArray(res.data) ? res.data : res.data.results ?? [];
}

export async function unmergeAlert(alertId: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.post(
    `/api/alerts/${alertId}/unmerge/`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
}

export type WorkbookInstanceItem = {
  id: string;
  label: string;
  order: number;
  is_done: boolean;
};

export type WorkbookInstance = {
  id: string;
  event: string;
  template: string | null;
  created_at: string;
  items: WorkbookInstanceItem[];
};

export type CaseWorkbookResponse = {
  workbook: WorkbookInstance | null;
};


export async function getCaseWorkbook(caseId: string): Promise<WorkbookInstance | null> {
  const res = await api.get<CaseWorkbookResponse>(`/api/cases/${caseId}/workbook/`);
  return res.data?.workbook ?? null;
}

export async function applyCaseWorkbookTemplate(caseId: string, templateId: string | null) {
  const csrfToken = await ensureCsrf();
  const res = await api.post(
    `/api/cases/${caseId}/workbook/apply/`,
    {
      template_id: templateId,
    },
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return res.data;
}

export async function patchWorkbookItem(itemId: string, payload: any) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/workbook-items/${itemId}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
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

export async function markCaseViewed(caseId: string) {
  const csrfToken = await ensureCsrf();
  const r = await api.post(
    `/api/cases/${caseId}/mark-viewed/`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return r.data as { detail: string; last_viewed_at: string };
}

export type LinkedTask = {
  id: string;
  title: string;
  status: string;
  priority?: string;
  due_date?: string | null;
  created_at: string;
  updated_at: string;
  owner?: number | null;
  owner_id?: number | null;
  owner_username?: string | null;
  customer_ids?: string[];
  customer_names?: string[];
  linked_case_count?: number;
  due_state?: string;
};

export async function listLinkedTasks(caseId: string): Promise<LinkedTask[]> {
  const res = await api.get(`/api/events/${caseId}/tasks/`);
  return Array.isArray(res.data) ? res.data : res.data.results ?? [];
}