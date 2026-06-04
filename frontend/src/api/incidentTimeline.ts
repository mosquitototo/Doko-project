import { api } from "./client";
import { ensureCsrf } from "./auth";

export type IncidentTimelineSeverity = "info" | "low" | "medium" | "high" | "critical";

export type IncidentTimelineItem = {
  id: string;
  case: string;
  occurred_at: string;
  title: string;
  details: string;
  kind: string;
  severity: IncidentTimelineSeverity;
  source: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
};

function unwrapItem<T>(data: any): T {
  return (data?.item ?? data) as T;
}

function unwrapList<T>(data: any): T[] {
  return (data?.results ?? data) as T[];
}

export async function listIncidentTimeline(caseId: string): Promise<IncidentTimelineItem[]> {
  const res = await api.get(`/api/cases/${caseId}/incident-timeline/`);
  return unwrapList<IncidentTimelineItem>(res.data);
}

export async function getIncidentTimelineItem(id: string): Promise<IncidentTimelineItem> {
  const res = await api.get(`/api/incident-timeline-items/${id}/`);
  return unwrapItem<IncidentTimelineItem>(res.data);
}

export async function createIncidentTimelineItem(
  caseId: string,
  payload: {
    occurred_at: string;
    title: string;
    details?: string;
    kind?: string;
    severity?: IncidentTimelineSeverity;
    source?: string;
  }
): Promise<IncidentTimelineItem> {
  const csrfToken = await ensureCsrf();
  const res = await api.post(`/api/cases/${caseId}/incident-timeline/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return unwrapItem<IncidentTimelineItem>(res.data);
}

export async function patchIncidentTimelineItem(
  id: string,
  payload: Partial<IncidentTimelineItem>
): Promise<IncidentTimelineItem> {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/incident-timeline-items/${id}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return unwrapItem<IncidentTimelineItem>(res.data);
}

export async function deleteIncidentTimelineItem(id: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/incident-timeline-items/${id}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}