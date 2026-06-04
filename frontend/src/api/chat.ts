import { api } from "./client";
import { ensureCsrf } from "./auth";

export type ChatSession = {
  id: string;
  title: string;
  surface: "dedicated" | "contextual";
  page_type?: string;
  object_id?: string;
  customer_id?: string;
  client_tab_id: string;
  created_at: string;
  updated_at: string;
  messages?: ChatMessage[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export type ChatDraft = {
  id: string;
  target_type: "case_comment" | "alert_comment" | "hunt_note";
  target_id: string;
  content: string;
  is_posted: boolean;
  posted_at?: string | null;
  created_at?: string;
};

export type ChatAction = {
  code: string;
  name: string;
  description: string;
  chat_command: string;
  command_help: string;
  entity_type: string;
  target_kind: string;
  soar_provider_name?: string;
  default_variables: Record<string, unknown>;
  allowed_variables_schema: Record<string, unknown>;
  prompt_overrides_schema: Record<string, unknown>;
};

export type ChatRun = {
  id: string;
  request_id: string;
  client_tab_id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  prompt: string;
  response_text: string;
  error_message: string;
  selected_template_code?: string;
  selected_command?: string;
  provider_execution?: Record<string, unknown>;
  cancel_requested?: boolean;
  cancel_requested_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
  drafts?: ChatDraft[];
};

type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (
    data &&
    typeof data === "object" &&
    "results" in data &&
    Array.isArray((data as Paginated<T>).results)
  ) {
    return (data as Paginated<T>).results;
  }
  return [];
}

export async function listChatSessions(): Promise<ChatSession[]> {
  const { data } = await api.get("/api/chat/sessions");
  return unwrapList<ChatSession>(data);
}

export async function createChatSession(payload: {
  title?: string;
  surface: "dedicated" | "contextual";
  page_type?: string;
  object_id?: string;
  customer_id?: string;
  client_tab_id: string;
}): Promise<ChatSession> {
  const csrfToken = await ensureCsrf();
  const { data } = await api.post("/api/chat/sessions", payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return data;
}

export async function createChatRun(sessionId: string, payload: {
  client_tab_id: string;
  request_id: string;
  message: string;
  page_type?: string;
  object_id?: string;
  current_tab?: string;
  inclusions?: string[];
  customer_id?: string;
  template_code?: string;
  chat_command?: string;
  variables?: Record<string, unknown>;
}): Promise<ChatRun> {
  const csrfToken = await ensureCsrf();
  const { data } = await api.post(`/api/chat/sessions/${sessionId}/runs`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return data;
}

export async function fetchChatRun(runId: string): Promise<ChatRun> {
  const { data } = await api.get(`/api/chat/runs/${runId}`);
  return data;
}

export async function generateDraft(runId: string, payload: {
  target_type: "case_comment" | "alert_comment" | "hunt_note";
  target_id: string;
}): Promise<ChatDraft> {
  const csrfToken = await ensureCsrf();
  const { data } = await api.post(`/api/chat/runs/${runId}/drafts`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return data;
}

export async function postDraft(draftId: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.post(
    `/api/chat/drafts/${draftId}/post`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
}

export async function clearChatSession(sessionId: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.post(
    `/api/chat/sessions/${sessionId}/clear`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
}

export async function archiveChatSession(sessionId: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.post(
    `/api/chat/sessions/${sessionId}/archive/`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
}

export async function listChatActions(params?: {
  page_type?: string;
  object_id?: string;
  customer_id?: string;
}): Promise<ChatAction[]> {
  const { data } = await api.get("/api/chat/actions", { params });
  return unwrapList<ChatAction>(data);
}

export async function cancelChatRun(runId: string): Promise<ChatRun> {
  const csrfToken = await ensureCsrf();
  const { data } = await api.post(
    `/api/chat/runs/${runId}/cancel`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return data;
}