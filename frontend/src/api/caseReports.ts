import { api } from "./client";
import { ensureCsrf } from "./auth";

export type ReportInstance = {
  id: string;
  case: string;
  template: string | null;
  template_name: string;
  template_version: number;
  created_at: string;
  pdf_url: string | null;
};

export async function listCaseReports(caseId: string): Promise<ReportInstance[]> {
  const res = await api.get(`/api/cases/${caseId}/reports/`);
  return Array.isArray(res.data) ? res.data : res.data.results ?? [];
}

export async function generateCaseReport(caseId: string, templateId: string, params?: any): Promise<ReportInstance> {
  const csrfToken = await ensureCsrf();
  const res = await api.post(
    `/api/cases/${caseId}/reports/generate/`,
    {
      template_id: templateId,
      params: params || {},
    },
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return res.data;
}