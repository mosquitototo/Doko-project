import { api } from "./client";
import { ensureCsrf } from "./auth";

export type CaseRetentionSettings = {
  auto_archive_after_days: number;
  hard_delete_after_days: number;
  exchange_send_template?: string | null;
  exchange_send_template_name?: string;
  updated_at?: string;
  updated_by?: number | null;
};

export async function getCaseRetentionSettings() {
  const res = await api.get(`/api/settings/case-retention/`);
  return res.data as CaseRetentionSettings;
}

export async function patchCaseRetentionSettings(payload: Partial<CaseRetentionSettings>) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/settings/case-retention/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data as CaseRetentionSettings;
}