import { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { useToast } from "../../components/ui/toast";
import { useMe } from "../../contexts/MeContext";
import {
  getInstanceSettings,
  saveProxySettings,
  createDatabaseBackup,
  downloadDatabaseBackup,
  restoreDatabaseBackup,
  exportAuditLogs,
  saveSplunkHecSettings,
  testSplunkHecConnection,
  type InstanceSettingsPayload,
} from "../../api/settingsInstance";

import { SaveButton, NewGenButton } from "../../components/ui/IconButton";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </label>
  );
}

function downloadBlob(filename: string, blob: Blob) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}


export default function InstanceSettings() {
  const { push } = useToast();
  const me = useMe();
  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canManage = can("settings.instance.manage");

  const [loading, setLoading] = useState(true);
  const [busyProxy, setBusyProxy] = useState(false);
  const [busyBackup, setBusyBackup] = useState(false);
  const [busyBackupDownload, setBusyBackupDownload] = useState(false);
  const [busyBackupRestore, setBusyBackupRestore] = useState(false);
  const [busyAudit, setBusyAudit] = useState(false);
  const [busySplunk, setBusySplunk] = useState(false);
  const [busySplunkTest, setBusySplunkTest] = useState(false);

  const [confirmBackup, setConfirmBackup] = useState(false);
  const [confirmBackupRestore, setConfirmBackupRestore] = useState(false);
  const [confirmAuditExport, setConfirmAuditExport] = useState(false);

  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyHost, setProxyHost] = useState("");
  const [proxyPort, setProxyPort] = useState("");
  const [proxyUsername, setProxyUsername] = useState("");
  const [proxyPassword, setProxyPassword] = useState("");

  const [auditFilename, setAuditFilename] = useState("doko-audit-export");
  const [auditFormat, setAuditFormat] = useState<"csv" | "jsonl">("csv");

  const [splunkEnabled, setSplunkEnabled] = useState(false);
  const [splunkEndpoint, setSplunkEndpoint] = useState("");
  const [splunkToken, setSplunkToken] = useState("");
  const [splunkIndex, setSplunkIndex] = useState("");
  const [splunkSource, setSplunkSource] = useState("doko:audit");
  const [splunkSourcetype, setSplunkSourcetype] = useState("_json");

  const [lastBackupId, setLastBackupId] = useState("");
  const [lastBackupFile, setLastBackupFile] = useState("");
  const [lastAuditFile, setLastAuditFile] = useState("");

  const [restoreFile, setRestoreFile] = useState<File | null>(null);

  const restoreFileLabel = useMemo(() => {
    if (!restoreFile) return "No file selected";
    return `${restoreFile.name} (${Math.ceil(restoreFile.size / 1024)} KB)`;
  }, [restoreFile]);

  useEffect(() => {
    let mounted = true;

    if (!canManage) {
      setLoading(false);
      return () => {
        mounted = false;
      };
    }

    getInstanceSettings()
      .then((data: InstanceSettingsPayload) => {
        if (!mounted) return;

        setProxyEnabled(!!data.proxy?.enabled);
        setProxyHost(data.proxy?.host || "");
        setProxyPort(data.proxy?.port ? String(data.proxy.port) : "");
        setProxyUsername(data.proxy?.username || "");
        setProxyPassword("");

        setSplunkEnabled(!!data.splunk_hec?.enabled);
        setSplunkEndpoint(data.splunk_hec?.endpoint || "");
        setSplunkToken("");
        setSplunkIndex(data.splunk_hec?.index || "");
        setSplunkSource(data.splunk_hec?.source || "doko:audit");
        setSplunkSourcetype(data.splunk_hec?.sourcetype || "_json");

        setLastBackupId(data.last_backup?.id || "");
        setLastBackupFile(data.last_backup?.filename || data.last_backup_file || "");
        setLastAuditFile(data.last_audit_export_file || "");
      })
      .catch(() => {
        if (!mounted) return;
        push({
          kind: "error",
          title: "Error",
          message: "Unable to load instance settings",
        });
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [push, canManage]);

  
  async function onSaveProxy() {
    if (!canManage) return;

    const parsedProxyPort = proxyPort.trim() ? Number(proxyPort.trim()) : null;

    if (
      parsedProxyPort !== null &&
      (!Number.isInteger(parsedProxyPort) || parsedProxyPort < 1 || parsedProxyPort > 65535)
    ) {
      push({
        kind: "error",
        title: "Invalid proxy port",
        message: "Port must be an integer between 1 and 65535.",
      });
      return;
    }

    setBusyProxy(true);
    try {
      await saveProxySettings({
        enabled: proxyEnabled,
        host: proxyHost.trim(),
        port: parsedProxyPort,
        username: proxyUsername.trim(),
        ...(proxyPassword ? { password: proxyPassword } : {}),
      });

      setProxyPassword("");

      push({
        kind: "success",
        title: "Proxy settings saved",
      });
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network"),
      });
    } finally {
      setBusyProxy(false);
    }
  }

  async function onCreateBackup() {
    if (!canManage) return;
    setBusyBackup(true);
    try {
      const result = await createDatabaseBackup();
      setLastBackupId(result.id || "");
      setLastBackupFile(result.filename || "");

      push({
        kind: "success",
        title: "Backup created",
        message: result.filename || "Database backup generated",
      });
    } catch (e: any) {
      push({
        kind: "error",
        title: "Backup failed",
        message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network"),
      });
    } finally {
      setBusyBackup(false);
      setConfirmBackup(false);
    }
  }

  async function onDownloadLastBackup() {
    if (!canManage) return;
    if (!lastBackupId || !lastBackupFile) {
      push({
        kind: "info",
        title: "No backup available",
        message: "Create a backup first.",
      });
      return;
    }

    setBusyBackupDownload(true);
    try {
      const blob = await downloadDatabaseBackup(lastBackupId);
      downloadBlob(lastBackupFile, blob);

      push({
        kind: "success",
        title: "Download started",
        message: lastBackupFile,
      });
    } catch (e: any) {
      push({
        kind: "error",
        title: "Download failed",
        message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network"),
      });
    } finally {
      setBusyBackupDownload(false);
    }
  }

  async function onRestoreBackup() {
    if (!canManage) return;
    if (!restoreFile) {
      push({
        kind: "info",
        title: "No file selected",
        message: "Choose a backup file first.",
      });
      return;
    }

    setBusyBackupRestore(true);
    try {
      await restoreDatabaseBackup(restoreFile);

      push({
        kind: "success",
        title: "Backup restored",
        message: "The database restore completed. Refresh the application state now.",
      });

      setRestoreFile(null);
    } catch (e: any) {
      push({
        kind: "error",
        title: "Restore failed",
        message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network"),
      });
    } finally {
      setBusyBackupRestore(false);
      setConfirmBackupRestore(false);
    }
  }

  async function onExportAudit() {
    if (!canManage) return;
    setBusyAudit(true);
    try {
      const blob = await exportAuditLogs({
        format: auditFormat,
      });

      const baseName = (auditFilename || "doko-audit-export").trim() || "doko-audit-export";
      const extension = auditFormat === "jsonl" ? "jsonl" : "csv";
      const filename = `${baseName}.${extension}`;

      downloadBlob(filename, blob);
      setLastAuditFile(filename);

      push({
        kind: "success",
        title: "Audit logs exported",
        message: `Generated ${filename}`,
      });
    } catch (e: any) {
      push({
        kind: "error",
        title: "Export failed",
        message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network"),
      });
    } finally {
      setBusyAudit(false);
      setConfirmAuditExport(false);
    }
  }

  async function onSaveSplunk() {
    if (!canManage) return;

    const normalizedSplunkEndpoint = splunkEndpoint.trim();

    if (!isValidHttpUrl(normalizedSplunkEndpoint)) {
      push({
        kind: "error",
        title: "Invalid Splunk HEC endpoint",
        message: "Endpoint must be a valid HTTP or HTTPS URL.",
      });
      return;
    }

    setBusySplunk(true);
    try {
      await saveSplunkHecSettings({
        enabled: true,
        endpoint: normalizedSplunkEndpoint,
        ...(splunkToken ? { token: splunkToken } : {}),
        index: splunkIndex.trim(),
        source: splunkSource.trim(),
        sourcetype: splunkSourcetype.trim(),
      });

      setSplunkToken("");

      push({
        kind: "success",
        title: "Splunk HEC settings saved",
      });
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network"),
      });
    } finally {
      setBusySplunk(false);
    }
  }

  async function onTestSplunk() {
    if (!canManage) return;

    const normalizedSplunkEndpoint = splunkEndpoint.trim();

    if (splunkEnabled && !isValidHttpUrl(normalizedSplunkEndpoint)) {
      push({
        kind: "error",
        title: "Invalid Splunk HEC endpoint",
        message: "Endpoint must be a valid HTTP or HTTPS URL.",
      });
      return;
    }

    setBusySplunkTest(true);
    try {
      const result = await testSplunkHecConnection({
        enabled: splunkEnabled,
        endpoint: normalizedSplunkEndpoint,
        ...(splunkToken ? { token: splunkToken } : {}),
        index: splunkIndex.trim(),
        source: splunkSource.trim(),
        sourcetype: splunkSourcetype.trim(),
      });

      push({
        kind: "success",
        title: "Splunk HEC connection successful",
        message: result?.detail || "Connection successful.",
      });
    } catch (e: any) {
      push({
        kind: "error",
        title: "Splunk HEC connection failed",
        message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network"),
      });
    } finally {
      setBusySplunkTest(false);
    }
  }

  if (!loading && !canManage) {
    return (
      <div className="space-y-3">
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          Instance settings
        </div>
        <div className="text-sm text-muted-foreground">Access denied.</div>
      </div>
    );
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          Instance settings
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          Configure instance-wide services, exports and maintenance actions.
        </div>
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-foreground">
              Proxy configuration
            </div>
            <div className="text-xs text-muted-foreground">
              Configure the instance outbound proxy used by external HTTP integrations.
            </div>
          </div>

          <SaveButton
            onClick={onSaveProxy}
            disabled={busyProxy}
            iconOnly={false}
            label={busyProxy ? "Saving..." : "Save"}
            title="Save proxy settings"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1">
            <FieldLabel>Enabled</FieldLabel>
            <select
              className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              value={proxyEnabled ? "1" : "0"}
              onChange={(e) => setProxyEnabled(e.target.value === "1")}
              disabled={busyProxy}
            >
              <option value="0">Disabled</option>
              <option value="1">Enabled</option>
            </select>
          </label>

          <label className="grid gap-1">
            <FieldLabel>Host</FieldLabel>
            <input
              className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              value={proxyHost}
              onChange={(e) => setProxyHost(e.target.value)}
              placeholder="proxy.example.local"
              disabled={busyProxy}
            />
          </label>

          <label className="grid gap-1">
            <FieldLabel>Port</FieldLabel>
            <input
              className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              value={proxyPort}
              onChange={(e) => setProxyPort(e.target.value)}
              placeholder="3128"
              disabled={busyProxy}
            />
          </label>

          <label className="grid gap-1">
            <FieldLabel>Username</FieldLabel>
            <input
              className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              value={proxyUsername}
              onChange={(e) => setProxyUsername(e.target.value)}
              placeholder="Optional"
              disabled={busyProxy}
            />
          </label>

          <label className="grid gap-1 sm:col-span-2">
            <FieldLabel>Password</FieldLabel>
            <input
              type="password"
              autoComplete="new-password"
              className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              value={proxyPassword}
              onChange={(e) => setProxyPassword(e.target.value)}
              placeholder="Leave empty to keep current secret"
              disabled={busyProxy}
            />
          </label>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-foreground">
              Database backup
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onDownloadLastBackup}
              disabled={busyBackupDownload || busyBackup || !lastBackupId}
              className="rounded-2xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              title="Download last backup"
            >
              {busyBackupDownload ? "Downloading..." : "Download last backup"}
            </button>

            <NewGenButton
              onClick={() => setConfirmBackup(true)}
              disabled={busyBackup}
              iconOnly={false}
              label={busyBackup ? "Running..." : "Create backup"}
              title="Create database backup"
            />
          </div>
        </div>

        {lastBackupFile ? (
          <div className="mt-3 text-xs text-muted-foreground">
            Last generated file: <span className="text-foreground">{lastBackupFile}</span>
          </div>
        ) : null}

        <div className="mt-5 border-t border-border pt-5">
          <div className="mb-3">
            <div className="text-sm font-semibold text-foreground">
              Restore backup
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
            Upload a PostgreSQL custom backup file (.dump or .backup). This will fully replace the current database.
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <label className="grid gap-1">
              <FieldLabel>Backup file</FieldLabel>
              <input
                type="file"
                accept=".dump,.backup,application/octet-stream"
                className="block w-full rounded-2xl border border-border bg-card px-3 py-2.5 text-sm text-foreground file:mr-3 file:rounded-xl file:border-0 file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground"
                onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
                disabled={busyBackupRestore}
              />
              <div className="text-xs text-muted-foreground">{restoreFileLabel}</div>
            </label>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setConfirmBackupRestore(true)}
                disabled={!restoreFile || busyBackupRestore}
                className="h-10 rounded-2xl border border-border bg-card px-4 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                title="Restore selected backup"
              >
                {busyBackupRestore ? "Restoring..." : "Restore backup"}
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            This action is sensitive. Please be careful.
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-foreground">
              Global audit export
            </div>
            <div className="text-xs text-muted-foreground">
              Export audit logs to a flat file in CSV or JSONL format.
            </div>
          </div>

          <NewGenButton
            onClick={() => setConfirmAuditExport(true)}
            disabled={busyAudit}
            iconOnly={false}
            label={busyAudit ? "Running..." : "Export audit"}
            title="Export audit logs"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1">
            <FieldLabel>Filename</FieldLabel>
            <input
              className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              value={auditFilename}
              onChange={(e) => setAuditFilename(e.target.value)}
              placeholder="doko-audit-export"
              disabled={busyAudit}
            />
          </label>

          <label className="grid gap-1">
            <FieldLabel>Format</FieldLabel>
            <select
              className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              value={auditFormat}
              onChange={(e) => setAuditFormat(e.target.value as "csv" | "jsonl")}
              disabled={busyAudit}
            >
              <option value="csv">CSV</option>
              <option value="jsonl">JSONL</option>
            </select>
          </label>
        </div>

        {lastAuditFile ? (
          <div className="mt-3 text-xs text-muted-foreground">
            Last generated file: <span className="text-foreground">{lastAuditFile}</span>
          </div>
        ) : null}
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-foreground">
              Splunk HEC export
            </div>
            <div className="text-xs text-muted-foreground">
              Configure a secure export target for audit events.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onTestSplunk}
              disabled={busySplunkTest || busySplunk}
              className="rounded-2xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              title="Test Splunk HEC connection"
            >
              {busySplunkTest ? "Testing..." : "Test connection"}
            </button>

            <SaveButton
              onClick={onSaveSplunk}
              disabled={busySplunk || busySplunkTest}
              iconOnly={false}
              label={busySplunk ? "Saving..." : "Save"}
              title="Save Splunk HEC settings"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1">
            <FieldLabel>Enabled</FieldLabel>
            <select
              className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              value={splunkEnabled ? "1" : "0"}
              onChange={(e) => setSplunkEnabled(e.target.value === "1")}
              disabled={busySplunk}
            >
              <option value="0">Disabled</option>
              <option value="1">Enabled</option>
            </select>
          </label>

          <label className="grid gap-1">
            <FieldLabel>HEC endpoint</FieldLabel>
            <input
              className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              value={splunkEndpoint}
              onChange={(e) => setSplunkEndpoint(e.target.value)}
              placeholder="https://splunk.example.com:8088/services/collector"
              disabled={busySplunk}
            />
          </label>

          <label className="grid gap-1 sm:col-span-2">
            <FieldLabel>HEC token</FieldLabel>
            <input
              type="password"
              autoComplete="new-password"
              className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              value={splunkToken}
              onChange={(e) => setSplunkToken(e.target.value)}
              placeholder="Leave empty to keep current token"
              disabled={busySplunk}
            />
          </label>

          <label className="grid gap-1">
            <FieldLabel>Index</FieldLabel>
            <input
              className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              value={splunkIndex}
              onChange={(e) => setSplunkIndex(e.target.value)}
              placeholder="main"
              disabled={busySplunk}
            />
          </label>

          <label className="grid gap-1">
            <FieldLabel>Source</FieldLabel>
            <input
              className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              value={splunkSource}
              onChange={(e) => setSplunkSource(e.target.value)}
              placeholder="doko:audit"
              disabled={busySplunk}
            />
          </label>

          <label className="grid gap-1 sm:col-span-2">
            <FieldLabel>Sourcetype</FieldLabel>
            <input
              className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              value={splunkSourcetype}
              onChange={(e) => setSplunkSourcetype(e.target.value)}
              placeholder="_json"
              disabled={busySplunk}
            />
          </label>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmBackup}
        title="Create backup"
        message="Generate a new database backup file now?"
        confirmText="Run"
        confirmTag="save"
        cancelText="Cancel"
        cancelTag="cancel"
        onCancel={() => {
          if (busyBackup) return;
          setConfirmBackup(false);
        }}
        onConfirm={onCreateBackup}
      />

      <ConfirmDialog
        open={confirmBackupRestore}
        title="Restore backup"
        message={
          restoreFile
            ? `Restore database from "${restoreFile.name}" ? This will replace the current database state.`
            : "Restore the selected backup file?"
        }
        confirmText="Restore"
        confirmTag="warning"
        cancelText="Cancel"
        cancelTag="cancel"
        onCancel={() => {
          if (busyBackupRestore) return;
          setConfirmBackupRestore(false);
        }}
        onConfirm={onRestoreBackup}
      />

      <ConfirmDialog
        open={confirmAuditExport}
        title="Export audit logs"
        message="Generate a new audit export file now?"
        confirmText="Run"
        confirmTag="save"
        cancelText="Cancel"
        cancelTag="cancel"
        onCancel={() => {
          if (busyAudit) return;
          setConfirmAuditExport(false);
        }}
        onConfirm={onExportAudit}
      />
    </div>
  );
}