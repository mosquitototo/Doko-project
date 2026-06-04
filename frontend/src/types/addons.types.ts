export type AddonAction = {
  action_id: string;
  label: string;
  scope: "case" | "ioc" | "asset";
  method: string;
  path: string;
  timeout_ms?: number;
  is_enabled: boolean;
};

export type Addon = {
  id: string;
  name: string;
  version: string;
  description: string;
  is_enabled: boolean;
  base_url: string;
  actions: AddonAction[];
};

export type RunAddonResponse = {
  run_id: string;
  status: "success" | "error" | "pending";
  http_status?: number | null;
  message?: string;
};
