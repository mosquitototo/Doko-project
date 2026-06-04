import { api } from "./client";

export type AuditLogItem = {
  id: string;
  created_at: string;
  actor: number | string | null;
  actor_username: string;
  action: string;
  object_type: string;
  object_id: string;
  object_repr: string;
  success: boolean;
  status_code?: number;
  ip_address?: string;
  user_agent?: string;
  method?: string;
  path?: string;
  request_id?: string;
  duration_ms?: number;
  metadata?: any;
};

export async function listAuditLogs(params: {
  q?: string;
  action?: string;
  object_type?: string;
  object_id?: string;
  actor_id?: string;
  success?: string;
  date_from?: string;
  date_to?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
} = {}) {
  const r = await api.get("/api/settings/audit/", { params });
  return r.data;
}

export async function getAuditLog(id: string) {
  const r = await api.get(`/api/settings/audit/${id}/`);
  return r.data as AuditLogItem;
}
