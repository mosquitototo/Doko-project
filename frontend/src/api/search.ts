import { api } from "./client";

export type SearchItem = {
  type:
    | "case"
    | "alert"
    | "hunt"
    | "case_comment"
    | "alert_comment"
    | "hunt_journal"
    | "ioc"
    | "asset";
  id: string;
  title: string;
  snippet: string;
  url: string;
  customer_name: string;
  updated_at: string | null;
  parent?: {
    type: string;
    id: string;
    url: string;
  } | null;
};

export type SearchResponse = {
  query: string;
  count: number;
  results: SearchItem[];
};

export async function unifiedSearch(q: string): Promise<SearchResponse> {
  const res = await api.get(`/api/search/?q=${encodeURIComponent(q)}`);
  return res.data as SearchResponse;
}