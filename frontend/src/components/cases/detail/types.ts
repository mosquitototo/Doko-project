export type KVRow = { key: string; value: string };

export type EnrichmentLite = {
  id: string;
  status: "success" | "error";
  created_at: string;
  addon_id?: string;
  action_id?: string;
  target_key?: string;
  target_value?: string;
  response_payload?: any;
  error?: string;
  summary?: string;
};

export type Tab = "summary" | "exchanges" | "iocs" | "assets" | "incident_timeline" | "activity";
