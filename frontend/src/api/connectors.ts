import { api } from "./client";
import { ensureCsrf } from "./auth";

export type ConnectorTargetType = "case" | "ioc" | "asset";
export type ConnectorTarget = { key: string; value: string };

export type RunConnectorRequest = {
  case_id: string;
  connector_instance_id: string;
  endpoint_id: string;
  target_type: ConnectorTargetType;
  targets: ConnectorTarget[];
  context?: any;
};

export async function runConnectorAction(payload: RunConnectorRequest) {
  const csrfToken = await ensureCsrf();
  const r = await api.post("/api/connectors/run/", payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return r.data as {
    run_id: string;
    status: "success" | "error";
    http_status: number;
    connector_result_ids: string[];
  };
}

export async function listConnectorResults(params: {
  case_id: string;
  target_type?: ConnectorTargetType;
  target_key?: string;
  target_value?: string;
}) {
  const r = await api.get("/api/connectors/results/", { params });
  return r.data as any[];
}

export type ConnectorAllowDomain = { id: string; domain: string; is_enabled: boolean; created_at: string };

export type ConnectorEndpoint = {
  id: string;
  instance_id: string;
  name: string;
  label: string;
  target_type: ConnectorTargetType;
  method: string;
  base_url: string;
  path_template: string;
  headers: any;
  timeout_ms: number;
  is_enabled: boolean;
  created_at: string;
};

export type ConnectorInstance = {
  id: string;
  name: string;
  description: string;
  connector_type: string;
  config: any;
  is_enabled: boolean;
  created_at: string;
  has_secret: boolean;
  endpoints: ConnectorEndpoint[];
};

export async function listConnectorInstances() {
  const r = await api.get("/api/connectors/instances/");
  return r.data as ConnectorInstance[];
}

export async function createConnectorInstance(payload: {
  name: string;
  description?: string;
  connector_type?: string;
  is_enabled?: boolean;
  config?: any;
  secret?: string;
}) {
  const csrfToken = await ensureCsrf();
  const r = await api.post("/api/connectors/instances/", payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return r.data as ConnectorInstance;
}

export async function patchConnectorInstance(instanceId: string, patch: any) {
  const csrfToken = await ensureCsrf();
  const r = await api.patch(`/api/connectors/instances/${instanceId}/`, patch, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return r.data as ConnectorInstance;
}

export async function deleteConnectorInstance(instanceId: string) {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/connectors/instances/${instanceId}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function addConnectorEndpoint(instanceId: string, payload: any) {
  const csrfToken = await ensureCsrf();
  const r = await api.post(`/api/connectors/instances/${instanceId}/endpoints/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return r.data as ConnectorEndpoint;
}

export async function patchConnectorEndpoint(endpointId: string, patch: any) {
  const csrfToken = await ensureCsrf();
  const r = await api.patch(`/api/connectors/endpoints/${endpointId}/`, patch, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return r.data as ConnectorEndpoint;
}

export async function deleteConnectorEndpoint(endpointId: string) {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/connectors/endpoints/${endpointId}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function listAllowlist() {
  const r = await api.get("/api/connectors/allowlist/");
  return r.data as ConnectorAllowDomain[];
}

export async function addAllowlistDomain(domain: string) {
  const csrfToken = await ensureCsrf();
  const r = await api.post(
    "/api/connectors/allowlist/",
    { domain, is_enabled: true },
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return r.data as ConnectorAllowDomain;
}

export async function patchAllowlistDomain(domainId: string, patch: any) {
  const csrfToken = await ensureCsrf();
  const r = await api.patch(`/api/connectors/allowlist/${domainId}/`, patch, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return r.data as ConnectorAllowDomain;
}

export async function deleteAllowlistDomain(domainId: string) {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/connectors/allowlist/${domainId}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}