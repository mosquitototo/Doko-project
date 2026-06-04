import { api } from "./client";
import { ensureCsrf } from "./auth";

export type BackupInfo = {
  id: string;
  filename: string;
  created_at?: string;
};

export type InstanceSettingsPayload = {
  proxy?: {
    enabled: boolean;
    host: string;
    port: number | null;
    username: string;
  };
  splunk_hec?: {
    enabled: boolean;
    endpoint: string;
    has_token?: boolean;
    index: string;
    source: string;
    sourcetype: string;
  };
  last_backup?: BackupInfo | null;
  last_backup_file?: string;
  last_audit_export_file?: string;
};

export async function getInstanceSettings(): Promise<InstanceSettingsPayload> {
  const { data } = await api.get("/api/settings/instance/");
  return data;
}

export async function saveProxySettings(payload: {
  enabled: boolean;
  host: string;
  port: number | null;
  username: string;
  password?: string;
}) {
  const csrfToken = await ensureCsrf();
  const { data } = await api.put("/api/settings/instance/proxy/", payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return data;
}

export async function createDatabaseBackup(): Promise<BackupInfo> {
  const csrfToken = await ensureCsrf();
  const { data } = await api.post(
    "/api/settings/instance/backup/",
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return data;
}

export async function downloadDatabaseBackup(backupId: string): Promise<Blob> {
  const { data } = await api.get(
    `/api/settings/instance/backup/${encodeURIComponent(backupId)}/download/`,
    {
      responseType: "blob",
    }
  );
  return data;
}

export async function restoreDatabaseBackup(file: File) {
  const csrfToken = await ensureCsrf();
  const formData = new FormData();
  formData.append("file", file);

  const { data } = await api.post(
    "/api/settings/instance/backup/restore/",
    formData,
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return data;
}

export async function exportAuditLogs(payload: {
  query?: string;
  date_from?: string;
  date_to?: string;
  include_failed_only?: boolean;
  format?: "csv" | "jsonl";
}) {
  const csrfToken = await ensureCsrf();
  const response = await api.post("/api/settings/instance/audit-export/", payload, {
    responseType: "blob",
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });

  return response.data as Blob;
}

export async function downloadAuditExport(filename: string): Promise<Blob> {
  const csrfToken = await ensureCsrf();
  const { data } = await api.get(
    `/api/settings/instance/audit-export/download/${encodeURIComponent(filename)}/`,
    {
      responseType: "blob",
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return data;
}

export async function saveSplunkHecSettings(payload: {
  enabled: boolean;
  endpoint: string;
  token?: string;
  index: string;
  source: string;
  sourcetype: string;
}) {
  const csrfToken = await ensureCsrf();
  const { data } = await api.put("/api/settings/instance/splunk-hec/", payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return data;
}

export async function testSplunkHecConnection(payload: {
  enabled: boolean;
  endpoint: string;
  token?: string;
  index: string;
  source: string;
  sourcetype: string;
}) {
  const csrfToken = await ensureCsrf();
  const { data } = await api.post("/api/settings/instance/splunk-hec/test/", payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return data as { ok: boolean; detail: string };
}