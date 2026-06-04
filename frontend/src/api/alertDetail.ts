import { api } from "./client";
import { ensureCsrf } from "./auth";

export type AlertComment = {
  id: string;
  text: string;
  author_label?: string
  author_display?: string
  created_at: string;
  updated_at: string;
};

export async function listAlertComments(alertId: string): Promise<AlertComment[]> {
  const res = await api.get(`/api/alerts/${alertId}/comments/`);
  const data = res.data;

  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;

  return [];
}

export async function addAlertComment(alertId: string, text: string): Promise<AlertComment> {
  const csrfToken = await ensureCsrf();
  const res = await api.post(
    `/api/alerts/${alertId}/comments/`,
    { text },
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return res.data;
}

export async function updateAlertComment(commentId: string, text: string): Promise<AlertComment> {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(
    `/api/alert-comments/${commentId}/`,
    { text },
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return res.data;
}

export async function deleteAlertComment(commentId: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/alert-comments/${commentId}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}