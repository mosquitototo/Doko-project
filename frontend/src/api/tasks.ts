import { api } from "./client";
import { ensureCsrf } from "./auth";

export type TaskStatus = "to_do" | "in_progress" | "done" | "canceled";
export type TaskPriority = "low" | "medium" | "high" | "critical";
export type TaskDueState = "none" | "normal" | "soon" | "overdue" | "completed";

export type TaskListItem = {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  owner_id?: number | null;
  owner_id_read?: number | null;
  owner_username?: string | null;
  customer_ids: string[];
  customer_names: string[];
  linked_case_count: number;
  due_state: TaskDueState;
};

export type TaskComment = {
  id: string;
  task?: string;
  text: string;
  created_at: string;
  updated_at: string;
  author_label?: string;
  author_display?: string;
};

export type TaskLinkedCase = {
  id: string;
  case: {
    id: string;
    case_number?: number | null;
    title: string;
    status: string;
    customer_name?: string | null;
    created_at: string;
    updated_at: string;
  };
  created_by?: number | null;
  created_by_username?: string | null;
  created_at: string;
};

export type TaskDetail = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  owner_id_read?: number | null;
  owner_username?: string | null;
  customer_ids?: string[];
  customer_names: string[];
  comments?: TaskComment[];
  case_links?: TaskLinkedCase[];
  linked_case_count: number;
  due_state: TaskDueState;
};

export async function listTasks(params: {
  scope?: "mine" | "all";
  search?: string;
  status?: string[];
  priority?: string[];
  owner?: string[];
  customer?: string[];
  ordering?: string;
  page?: number;
  page_size?: number;
} = {}) {
  const res = await api.get(`/api/tasks/`, {
    params: {
      scope: params.scope || undefined,
      search: params.search || undefined,
      status: params.status?.length ? params.status : undefined,
      priority: params.priority?.length ? params.priority : undefined,
      owner: params.owner?.length ? params.owner : undefined,
      customer: params.customer?.length ? params.customer : undefined,
      ordering: params.ordering || undefined,
      page: params.page || undefined,
      page_size: params.page_size || undefined,
    },
    paramsSerializer: {
      indexes: null,
    } as any,
  });
  return Array.isArray(res.data) ? { results: res.data, count: res.data.length } : res.data;
}

export async function createTask(payload: {
  title: string;
  description?: string;
  due_date?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  owner_id?: number | null;
  customer_ids?: string[];
}) {
  const csrfToken = await ensureCsrf();
  const body = {
    ...payload,
    customer_ids_write: payload.customer_ids,
  };

  delete (body as any).customer_ids;

  const res = await api.post(`/api/tasks/`, body, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function fetchTaskDetail(id: string) {
  const res = await api.get(`/api/tasks/${id}/`);
  return res.data as TaskDetail;
}

export async function patchTask(
  id: string,
  payload: Partial<{
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    due_date: string | null;
    owner_id: number | null;
    customer_ids: string[];
  }>
) {
  const csrfToken = await ensureCsrf();
  const body = {
    ...payload,
    customer_ids_write: payload.customer_ids,
  };

  delete (body as any).customer_ids;

  const res = await api.patch(`/api/tasks/${id}/`, body, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function deleteTask(id: string) {
  const csrfToken = await ensureCsrf();
  const res = await api.delete(`/api/tasks/${id}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function listTaskComments(taskId: string) {
  const res = await api.get(`/api/tasks/${taskId}/comments/`);
  return Array.isArray(res.data)
    ? res.data
    : Array.isArray(res.data?.results)
    ? res.data.results
    : [];
}

export async function createTaskComment(taskId: string, payload: { text: string }) {
  const csrfToken = await ensureCsrf();
  const res = await api.post(`/api/tasks/${taskId}/comments/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function patchTaskComment(commentId: string, payload: Partial<{ text: string }>) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/task-comments/${commentId}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function deleteTaskComment(commentId: string) {
  const csrfToken = await ensureCsrf();
  const res = await api.delete(`/api/task-comments/${commentId}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function listTaskCaseLinks(taskId: string) {
  const res = await api.get(`/api/tasks/${taskId}/cases/`);
  return Array.isArray(res.data)
    ? res.data
    : Array.isArray(res.data?.results)
    ? res.data.results
    : [];
}

export async function createTaskCaseLink(taskId: string, payload: { case_id: string }) {
  const csrfToken = await ensureCsrf();
  const res = await api.post(`/api/tasks/${taskId}/cases/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function deleteTaskCaseLink(linkId: string) {
  const csrfToken = await ensureCsrf();
  const res = await api.delete(`/api/task-case-links/${linkId}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}