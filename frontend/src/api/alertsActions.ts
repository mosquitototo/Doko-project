import { api } from "./client";
import { ensureCsrf } from "./auth";

export type MergeAlertResponse = {
  alert_id: string;
  case_id: string;
  linked?: boolean;
  already_linked?: boolean;
  conflict?: boolean;
  current_case_id?: string;
  created_case?: boolean;
  error?: string;
};

export async function escalateAlert(alertId: string, payload?: any): Promise<MergeAlertResponse> {
  const csrfToken = await ensureCsrf();
  const res = await api.post(`/api/alerts/${alertId}/escalate/`, payload ?? {}, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function mergeAlertIntoCase(alertId: string, caseId: string): Promise<MergeAlertResponse> {
  const csrfToken = await ensureCsrf();
  const res = await api.post(
    `/api/alerts/${alertId}/link/`,
    { case_id: caseId },
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return res.data;
}

export async function deleteAlert(alertId: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.post(
    `/api/alerts/${alertId}/delete/`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
}