import { api } from "./client";

export type CaseLite = {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  customer?: string | null;
};

export async function fetchCasesLite(q?: string): Promise<CaseLite[]> {
  const res = await api.get("/api/cases-lite/", { params: q ? { q } : undefined });
  return res.data;
}
