import { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { useToast } from "../../components/ui/toast";
import { useMe } from "../../contexts/MeContext";
import {
  addAllowlistDomain,
  addConnectorEndpoint,
  createConnectorInstance,
  deleteAllowlistDomain,
  deleteConnectorEndpoint,
  deleteConnectorInstance,
  listAllowlist,
  listConnectorInstances,
  patchAllowlistDomain,
  patchConnectorEndpoint,
  patchConnectorInstance,
  type ConnectorAllowDomain,
  type ConnectorEndpoint,
  type ConnectorInstance,
} from "../../api/connectors";
import {
  DeleteButton,
  NewGenButton,
  RefreshButton,
  ResetButton,
  SaveButton,
} from "../../components/ui/IconButton";



function safeJsonParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function prettyJson(v: any): string {
  try {
    return JSON.stringify(v ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function normalizeBaseUrl(v: string) {
  let x = (v || "").trim();
  if (!x) return "";
  if (!x.endsWith("/")) x += "/";
  return x;
}

const DEFAULT_HEADERS_OBJ: Record<string, string> = {
  accept: "application/json",
};

const DEFAULT_HEADERS_TEXT = prettyJson(DEFAULT_HEADERS_OBJ);

function FieldLabel({
  children,
  required = false,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
      {required ? <span className="ml-1 text-destructive">*</span> : null}
    </div>
  );
}

function SettingInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & { className?: string }
) {
  return (
    <input
      {...props}
      className={[
        "h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition",
        "placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

function SettingSelect(
  props: React.SelectHTMLAttributes<HTMLSelectElement> & { className?: string }
) {
  return (
    <select
      {...props}
      className={[
        "h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition",
        "focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

function SettingTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { className?: string }
) {
  return (
    <textarea
      {...props}
      className={[
        "w-full rounded-2xl border border-border bg-card px-3 py-3 text-sm text-foreground outline-none transition resize-none",
        "placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

function SectionHint({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-xs text-muted-foreground">{children}</div>;
}

function StatusPill({
  enabled,
  enabledLabel = "Enabled",
  disabledLabel = "Disabled",
}: {
  enabled: boolean;
  enabledLabel?: string;
  disabledLabel?: string;
}) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
        enabled
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "border-border bg-muted text-muted-foreground",
      ].join(" ")}
    >
      {enabled ? enabledLabel : disabledLabel}
    </span>
  );
}


function isValidHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}


export default function Connectors() {
  const { push } = useToast();
  const me = useMe();
  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canView = can("settings.connectors.view");
  const canManage = can("settings.connectors.manage");
  const canDelete = can("settings.connectors.delete");

  const [loading, setLoading] = useState(false);

  const [allowlist, setAllowlist] = useState<ConnectorAllowDomain[]>([]);
  const [instances, setInstances] = useState<ConnectorInstance[]>([]);

  const [allowDomain, setAllowDomain] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createSecret, setCreateSecret] = useState("");

  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("");

  const selectedInstance = useMemo(
    () => instances.find((x) => x.id === selectedInstanceId) || null,
    [instances, selectedInstanceId]
  );

  const [confirm, setConfirm] = useState<
    null | { kind: "instance" | "endpoint" | "domain"; id: string; label: string }
  >(null);

  async function refreshAll() {
    if (!canView) {
      setAllowlist([]);
      setInstances([]);
      setSelectedInstanceId("");
      return;
    }
    setLoading(true);
    try {
      const [a, i] = await Promise.all([listAllowlist(), listConnectorInstances()]);
      setAllowlist(a ?? []);
      setInstances(i ?? []);
      if (!selectedInstanceId && (i ?? []).length) {
        setSelectedInstanceId((i ?? [])[0].id);
      } else if (
        selectedInstanceId &&
        !(i ?? []).some((x) => x.id === selectedInstanceId)
      ) {
        setSelectedInstanceId((i ?? [])[0]?.id ?? "");
      }
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? e?.message ?? "network"),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canView) {
      setAllowlist([]);
      setInstances([]);
      setSelectedInstanceId("");
      return;
    }
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  async function onAddAllowDomain() {
    if (!canManage) return;
    const d = allowDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
    if (!d) return;

    setLoading(true);
    try {
      await addAllowlistDomain(d);
      push({ kind: "success", title: "Domain added" });
      setAllowDomain("");
      await refreshAll();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setLoading(false);
    }
  }

  async function toggleAllowDomain(row: ConnectorAllowDomain, next: boolean) {
    if (!canManage) return;
    setLoading(true);
    try {
      await patchAllowlistDomain(row.id, { is_enabled: next });
      await refreshAll();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setLoading(false);
    }
  }

  async function onCreateInstance() {
    if (!canManage) return;
    const name = createName.trim();
    if (!name) return;

    setLoading(true);
    try {
      const inst = await createConnectorInstance({
        name,
        description: createDesc,
        connector_type: "http",
        is_enabled: true,
        config: {},
        secret: createSecret.trim() ? createSecret.trim() : undefined,
      });

      push({ kind: "success", title: "Instance created" });
      setCreateOpen(false);
      setCreateName("");
      setCreateDesc("");
      setCreateSecret("");
      await refreshAll();
      setSelectedInstanceId(inst.id);
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setLoading(false);
    }
  }

  async function patchInstance(instanceId: string, patch: any) {
    if (!canManage) return;
    setLoading(true);
    try {
      await patchConnectorInstance(instanceId, patch);
      push({ kind: "success", title: "Saved" });
      await refreshAll();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setLoading(false);
    }
  }

  const [instName, setInstName] = useState("");
  const [instDesc, setInstDesc] = useState("");
  const [instEnabled, setInstEnabled] = useState(true);
  const [instNextSecret, setInstNextSecret] = useState("");

  useEffect(() => {
    if (!selectedInstance) {
      setInstName("");
      setInstDesc("");
      setInstEnabled(true);
      setInstNextSecret("");
      return;
    }
    setInstName(selectedInstance.name || "");
    setInstDesc(selectedInstance.description || "");
    setInstEnabled(!!selectedInstance.is_enabled);
    setInstNextSecret("");
  }, [selectedInstanceId, selectedInstance?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const instanceDirty = useMemo(() => {
    if (!selectedInstance) return false;
    const baseDirty =
      (instName || "").trim() !== (selectedInstance.name || "").trim() ||
      (instDesc || "").trim() !== (selectedInstance.description || "").trim() ||
      !!instEnabled !== !!selectedInstance.is_enabled;
    const secretDirty = !!instNextSecret.trim();
    return baseDirty || secretDirty;
  }, [selectedInstance, instName, instDesc, instEnabled, instNextSecret]);

  async function onSaveInstance() {
    if (!canManage) return;
    if (!selectedInstance) return;

    const n = (instName || "").trim();
    if (!n) {
      push({
        kind: "error",
        title: "Error",
        message: "Instance name is required.",
      });
      return;
    }

    const patch: any = {};
    if (n !== (selectedInstance.name || "").trim()) patch.name = n;
    if ((instDesc || "") !== (selectedInstance.description || ""))
      patch.description = instDesc || "";
    if (!!instEnabled !== !!selectedInstance.is_enabled)
      patch.is_enabled = !!instEnabled;

    const s = instNextSecret.trim();
    if (s) patch.secret = s;

    if (Object.keys(patch).length === 0) return;

    await patchInstance(selectedInstance.id, patch);
    setInstNextSecret("");
  }

  function onResetInstanceDraft() {
    if (!selectedInstance) return;
    setInstName(selectedInstance.name || "");
    setInstDesc(selectedInstance.description || "");
    setInstEnabled(!!selectedInstance.is_enabled);
    setInstNextSecret("");
  }

  const [epName, setEpName] = useState("");
  const [epLabel, setEpLabel] = useState("");
  const [epMethod, setEpMethod] = useState("GET");
  const [epBaseUrl, setEpBaseUrl] = useState("");
  const [epPathTemplate, setEpPathTemplate] = useState("");
  const [epHeadersText, setEpHeadersText] = useState(DEFAULT_HEADERS_TEXT);
  const [epTimeoutMs, setEpTimeoutMs] = useState(8000);

  const [editingEndpointId, setEditingEndpointId] = useState<string>("");

  const editingEndpoint = useMemo(() => {
    if (!selectedInstance || !editingEndpointId) return null;
    return (
      (selectedInstance.endpoints || []).find((x) => x.id === editingEndpointId) ||
      null
    );
  }, [selectedInstance, editingEndpointId]);

  function resetEndpointFormFrom(endpoint?: ConnectorEndpoint | null) {
    if (!endpoint) {
      setEditingEndpointId("");
      setEpName("");
      setEpLabel("");
      setEpMethod("GET");
      setEpBaseUrl("");
      setEpPathTemplate("");
      setEpHeadersText(DEFAULT_HEADERS_TEXT);
      setEpTimeoutMs(8000);
      return;
    }

    setEditingEndpointId(endpoint.id);
    setEpName(endpoint.name || "");
    setEpLabel(endpoint.label || "");
    setEpMethod((endpoint.method || "GET").toUpperCase());
    setEpBaseUrl(endpoint.base_url || "");
    setEpPathTemplate(endpoint.path_template || "");
    setEpHeadersText(prettyJson((endpoint as any).headers ?? DEFAULT_HEADERS_OBJ));
    setEpTimeoutMs(Number(endpoint.timeout_ms ?? 8000));
  }

  useEffect(() => {
    resetEndpointFormFrom(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInstanceId]);

  function insertSecretHeaderHint() {
    if (!canManage) return;
    const obj = safeJsonParse(epHeadersText);
    if (obj == null || typeof obj !== "object" || Array.isArray(obj)) {
      push({
        kind: "error",
        title: "Invalid headers JSON",
        message: "Fix JSON first, then insert secret header.",
      });
      return;
    }
    if (
      obj["x-apikey"] === "{{secret}}" ||
      obj["Authorization"] === "Bearer {{secret}}"
    )
      return;

    if (!obj["Authorization"] && !obj["authorization"]) {
      obj["Authorization"] = "Bearer {{secret}}";
    } else if (!obj["x-apikey"] && !obj["x-api-key"] && !obj["X-API-Key"]) {
      obj["x-apikey"] = "{{secret}}";
    }

    setEpHeadersText(prettyJson(obj));
  }

  async function onSaveEndpoint() {
    if (!canManage) return;
    if (!selectedInstance) return;

    const name = epName.trim();
    const label = epLabel.trim();
    const base_url = normalizeBaseUrl(epBaseUrl);
    const path_template = (epPathTemplate || "").trim();
    const method = (epMethod || "GET").trim().toUpperCase();
    const timeout_ms = Number(epTimeoutMs || 8000);
    
    if (!Number.isInteger(timeout_ms) || timeout_ms < 1000 || timeout_ms > 60000) {
      push({
        kind: "error",
        title: "Invalid timeout",
        message: "Timeout must be an integer between 1000 and 60000 ms.",
      });
      return;
    }

    if (!name || !base_url || !path_template) return;

    if (!isValidHttpsUrl(base_url)) {
      push({
        kind: "error",
        title: "Invalid base URL",
        message: "Base URL must be a valid HTTPS URL.",
      });
      return;
    }

    const headersObj = safeJsonParse(epHeadersText);
    if (headersObj == null || typeof headersObj !== "object" || Array.isArray(headersObj)) {
      push({
        kind: "error",
        title: "Invalid headers JSON",
        message: "Headers must be a JSON object.",
      });
      return;
    }

    setLoading(true);
    try {
      let saved: ConnectorEndpoint;

      if (editingEndpointId) {
        saved = await patchConnectorEndpoint(editingEndpointId, {
          name,
          label,
          method,
          base_url,
          path_template,
          headers: headersObj,
          timeout_ms,
        });
        push({ kind: "success", title: "Endpoint updated" });
      } else {
        saved = await addConnectorEndpoint(selectedInstance.id, {
          name,
          label: label || name,
          target_type: "case",
          method,
          base_url,
          path_template,
          headers: headersObj,
          timeout_ms,
          is_enabled: true,
        });
        push({ kind: "success", title: "Endpoint created" });
      }

      await refreshAll();
      resetEndpointFormFrom(saved);
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setLoading(false);
    }
  }

  async function toggleEndpoint(ep: ConnectorEndpoint, next: boolean) {
    if (!canManage) return;
    setLoading(true);
    try {
      await patchConnectorEndpoint(ep.id, { is_enabled: next });
      await refreshAll();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setLoading(false);
    }
  }


  if (!canView) {
    return (
      <div className="space-y-3">
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          Connectors
        </div>
        <div className="text-sm text-muted-foreground">Access denied.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-3xl font-semibold tracking-tight text-foreground">
            Connectors
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Endpoint actions for IoC and asset enrichment.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <RefreshButton
            onClick={() => void refreshAll()}
            disabled={loading || !canView}
            iconOnly={false}
            label={loading ? "Refreshing…" : "Refresh"}
            title="Refresh"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </RefreshButton>

          <NewGenButton
            onClick={() => setCreateOpen(true)}
            disabled={loading || !canManage}
            iconOnly={false}
            label="New instance"
            title="New instance"
          >
            New instance
          </NewGenButton>
        </div>
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-lg font-semibold text-foreground">
              Allowed domains
            </div>
            <SectionHint>
              Only these domains and their subdomains can be reached by the connectors. Subdomains are allowed automatically.
              You must add a domain before adding an endpoint.
            </SectionHint>
          </div>

          <div className="flex w-full max-w-xl flex-col gap-2 sm:flex-row">
            <SettingInput
              placeholder="api.example.com"
              value={allowDomain}
              onChange={(e) => setAllowDomain(e.target.value)}
              disabled={loading || !canManage}
            />
            <NewGenButton
              onClick={onAddAllowDomain}
              disabled={loading || !canManage || !allowDomain.trim()}
              title="Add domain"
            >
              Add
            </NewGenButton>
          </div>
        </div>

        {allowlist.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No domain allowed yet.
          </div>
        ) : (
          <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-card">
            {allowlist.map((d, index) => (
              <div
                key={d.id}
                className={[
                  "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
                  index > 0 ? "border-t border-border" : "",
                ].join(" ")}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <StatusPill
                    enabled={!!d.is_enabled}
                    enabledLabel="Allowed"
                    disabledLabel="Disabled"
                  />
                  <div className="truncate text-sm font-semibold text-foreground">
                    {d.domain}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3">
                  <label className="inline-flex items-center gap-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={!!d.is_enabled}
                      onChange={(e) => void toggleAllowDomain(d, e.target.checked)}
                      disabled={loading || !canManage}
                      className="h-4 w-4 rounded border-border"
                    />
                    <span>Enabled</span>
                  </label>

                  <DeleteButton
                    onClick={() =>
                      setConfirm({
                        kind: "domain",
                        id: d.id,
                        label: d.domain,
                      })
                    }
                    disabled={loading || !canDelete}
                    title="Delete domain"
                  >
                    Delete
                  </DeleteButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-lg font-semibold text-foreground">Instances</div>
            <div className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
              {instances.length}
            </div>
          </div>

          {instances.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No instance yet.
            </div>
          ) : (
            <div className="space-y-2">
              {instances.map((i) => {
                const active = i.id === selectedInstanceId;
                return (
                  <button
                    key={i.id}
                    type="button"
                    className={[
                      "w-full cursor-pointer rounded-2xl border p-4 text-left transition",
                      active
                        ? "border-foreground bg-foreground text-background shadow-sm"
                        : "border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground",
                    ].join(" ")}
                    onClick={() => setSelectedInstanceId(i.id)}
                    disabled={loading || !canView}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {i.name}
                        </div>
                        <div
                          className={`mt-1 text-[11px] ${
                            active ? "text-background/75" : "text-muted-foreground"
                          }`}
                        >
                          {i.is_enabled ? "enabled" : "disabled"} •{" "}
                          {i.connector_type} • {i.endpoints?.length ?? 0} endpoint(s)
                        </div>
                      </div>

                      <div
                        className={`shrink-0 text-[11px] ${
                          active ? "text-background/75" : "text-muted-foreground"
                        }`}
                      >
                        {i.has_secret ? "secret ✓" : "secret —"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="text-lg font-semibold text-foreground">
              Instance settings
            </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background p-3">
                <label className="inline-flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={!!instEnabled}
                    onChange={(e) => setInstEnabled(e.target.checked)}
                    disabled={loading || !canManage}
                    className="h-4 w-4 rounded border-border"
                  />
                  <span>Enabled</span>
                </label>
                {selectedInstance ? (
                  <DeleteButton
                    onClick={() =>
                      setConfirm({
                        kind: "instance",
                        id: selectedInstance.id,
                        label: selectedInstance.name,
                      })
                    }
                    disabled={loading || !canDelete}
                    title="Delete instance"
                  >
                    Delete
                  </DeleteButton>
                ) : null}
              </div>

          </div>

          {!selectedInstance ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Select an instance.
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="space-y-2">
                  <FieldLabel required>Name</FieldLabel>
                  <SettingInput
                    value={instName}
                    onChange={(e) => setInstName(e.target.value)}
                    disabled={loading || !canManage}
                  />
                </label>
              </div>

              <div>
                <label className="space-y-2">
                  <FieldLabel>Description</FieldLabel>
                  <SettingTextarea
                    rows={4}
                    value={instDesc}
                    onChange={(e) => setInstDesc(e.target.value)}
                    disabled={loading || !canManage}
                  />
                </label>
              </div>
              
              <div className="space-y-2 rounded-2xl border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel>Secret (API key / token)</FieldLabel>
                  <div
                    className={`text-xs ${
                      selectedInstance.has_secret
                        ? "font-medium text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {selectedInstance.has_secret ? "Configured ✓" : "Not set"}
                  </div>
                </div>

                <SettingInput
                  placeholder={
                    selectedInstance.has_secret
                      ? "(hidden) • enter to replace"
                      : "enter to set"
                  }
                  value={instNextSecret}
                  onChange={(e) => setInstNextSecret(e.target.value)}
                  disabled={loading || !canManage}
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-2">
                <ResetButton
                  onClick={onResetInstanceDraft}
                  disabled={loading || !instanceDirty || !canManage}
                  title="Reset instance"
                >
                  Reset
                </ResetButton>

                <SaveButton
                  onClick={() => void onSaveInstance()}
                  disabled={loading || !instanceDirty}
                  type="button"
                  title="Save instance"
                >
                  {loading ? "Saving…" : "Save"}
                </SaveButton>
              </div>
            </div>
          )}
        </Card>
      </div>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="text-lg font-semibold text-foreground">Endpoints</div>
            <NewGenButton
              onClick={() => resetEndpointFormFrom(null)}
              disabled={loading || !canManage}
              title="Add endpoint"
            >
              Add endpoint
            </NewGenButton>
          </div>

          {!selectedInstance ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Select an instance.
            </div>
          ) : (
            <div className="space-y-5">
              {(selectedInstance.endpoints?.length ?? 0) === 0 ? (
                <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No endpoint yet.
                </div>
              ) : (
              <div className="overflow-hidden rounded-2xl border border-border bg-background">
                {selectedInstance.endpoints
                  .slice()
                  .sort((a, b) =>
                    (a.label || a.name || "").localeCompare(b.label || b.name || "")
                  )
                  .map((ep, index) => {
                    const isSelected = editingEndpointId === ep.id;
                    const method = (ep.method || "GET").toUpperCase();

                    return (
                      <div
                        key={ep.id}
                        className={[
                          "group flex flex-col gap-4 px-4 py-4 transition sm:flex-row sm:items-center sm:justify-between",
                          index > 0 ? "border-t border-border/70" : "",
                          isSelected ? "bg-accent/60" : "hover:bg-muted/40",
                        ].join(" ")}
                      >
                        <button
                          className="min-w-0 cursor-pointer border-none bg-transparent flex-1 text-left"
                          type="button"
                          onClick={() => resetEndpointFormFrom(ep)}
                          disabled={loading || !canManage}
                          title="Edit endpoint"
                        >
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-semibold text-foreground">
                              {ep.label || ep.name}
                            </span>

                            <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                              {method}
                            </span>

                            {isSelected ? (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-foreground px-2 py-0.5 text-[10px] font-medium text-background">
                                Editing
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-2 min-w-0 space-y-1">
                            <div className="truncate font-mono text-[11px] text-muted-foreground">
                              {ep.base_url}
                            </div>
                            <div className="truncate font-mono text-[11px] text-muted-foreground/80">
                              {ep.path_template || "/"}
                            </div>
                          </div>
                        </button>

                        <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-border bg-background"
                              checked={!!ep.is_enabled}
                              onChange={(e) => void toggleEndpoint(ep, e.target.checked)}
                              disabled={loading || !canManage}
                            />
                            <span>{ep.is_enabled ? "Enabled" : "Disabled"}</span>
                          </label>

                          <DeleteButton
                            onClick={() =>
                              setConfirm({
                                kind: "endpoint",
                                id: ep.id,
                                label: ep.label || ep.name,
                              })
                            }
                            disabled={loading || !canDelete}
                            title="Delete endpoint"
                          >
                            Delete
                          </DeleteButton>
                        </div>
                      </div>
                    );
                  })}
              </div>
              )}

              <div className="space-y-4 border-t border-border pt-5">
                <div>
                  <div className="text-base mb-7 font-semibold text-foreground">
                    {editingEndpointId ? "Edit selected endpoint" : "Create new endpoint"}
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <label className="space-y-2">
                    <FieldLabel required>Name</FieldLabel>
                    <SettingInput
                      value={epName}
                      onChange={(e) => setEpName(e.target.value)}
                      disabled={loading || !canManage}
                      placeholder="ip_check"
                    />
                  </label>

                  <label className="space-y-2">
                    <FieldLabel>Label (UI)</FieldLabel>
                    <SettingInput
                      value={epLabel}
                      onChange={(e) => setEpLabel(e.target.value)}
                      disabled={loading || !canManage}
                      placeholder="My API - IP check"
                    />
                  </label>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <label className="space-y-2">
                    <FieldLabel>Method</FieldLabel>
                    <SettingSelect
                      value={epMethod}
                      onChange={(e) => setEpMethod(e.target.value)}
                      disabled={loading || !canManage}
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="PATCH">PATCH</option>
                      <option value="DELETE">DELETE</option>
                    </SettingSelect>
                  </label>

                  <label className="space-y-2">
                    <FieldLabel>Timeout (ms)</FieldLabel>
                    <SettingInput
                      value={String(epTimeoutMs)}
                      onChange={(e) => setEpTimeoutMs(Number(e.target.value || 0))}
                      disabled={loading || !canManage}
                      type="number"
                      min={1000}
                      step={500}
                    />
                  </label>
                </div>

                <div className="pt-4">
                  <label className="space-y-2">
                    <FieldLabel required>Base URL (https)</FieldLabel>
                    <SettingInput
                      value={epBaseUrl}
                      onChange={(e) => setEpBaseUrl(e.target.value)}
                      disabled={loading || !canManage}
                      placeholder="https://api.example.com/v1/"
                    />
                  </label>
                </div>

                <div className="pt-4">
                  <label className="space-y-2">
                    <FieldLabel required>Path template</FieldLabel>
                    <SettingInput
                      className="font-mono"
                      value={epPathTemplate}
                      onChange={(e) => setEpPathTemplate(e.target.value)}
                      disabled={loading || !canManage}
                      placeholder="ip/{{value}}"
                    />
                    <div className="text-[11px] italic text-muted-foreground">
                      Use{" "}
                      <span className="font-mono text-foreground">
                        {"{{value}}"}
                      </span>
                      ,{" "}
                      <span className="font-mono text-foreground">
                        {"{{key}}"}
                      </span>{" "}
                      and{" "}
                      <span className="font-mono text-foreground">
                        {"{{case_id}}"}
                      </span>
                      .
                    </div>
                  </label>
                </div>

                <div className="pt-4">
                  <div className="flex pb-1 flex-wrap items-center justify-between gap-2">
                    <FieldLabel>Headers (JSON)</FieldLabel>
                    <button
                      className="rounded-xl border border-border bg-card px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                      type="button"
                      disabled={loading || !canManage}
                      onClick={insertSecretHeaderHint}
                      title="Insert secret helper"
                    >
                      Insert secret helper
                    </button>
                  </div>

                  <SettingTextarea
                    className="min-h-[180px] resize-y font-mono text-[12px]"
                    rows={7}
                    value={epHeadersText}
                    onChange={(e) => setEpHeadersText(e.target.value)}
                    disabled={loading || !canManage}
                  />

                  <div className="text-[11px] italic text-muted-foreground">
                    Use{" "}
                    <span className="font-mono text-foreground">
                      {"{{secret}}"}
                    </span>{" "}
                    to inject the instance secret.
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2">
                  <ResetButton
                    onClick={() => resetEndpointFormFrom(null)}
                    disabled={loading || !canManage}
                    title="Reset endpoint"
                  >
                    Reset
                  </ResetButton>

                  <SaveButton
                    onClick={() => void onSaveEndpoint()}
                    disabled={
                      loading ||
                      !selectedInstance ||
                      !epName.trim() ||
                      !epBaseUrl.trim() ||
                      !epPathTemplate.trim() || 
                      !canManage
                    }
                    title="Save endpoint"
                  >
                    {loading
                      ? "Saving…"
                      : editingEndpointId
                      ? "Save changes"
                      : "Create endpoint"}
                  </SaveButton>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={createOpen}
        title="Create connector instance"
        message={
          <div className="space-y-4">
            <div className="text-sm text-foreground">
              Create a new <b>HTTP</b> connector instance and optionally store a
              secret for authenticated calls.
            </div>

            <label className="space-y-2">
              <FieldLabel required>Name</FieldLabel>
              <SettingInput
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="My SaaS - Prod"
                disabled={loading || !canManage}
              />
            </label>

            <label className="space-y-2">
              <FieldLabel>Description</FieldLabel>
              <SettingTextarea
                rows={3}
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                placeholder="External enrichment provider"
                disabled={loading || !canManage}
              />
            </label>

            <label className="space-y-2">
              <FieldLabel>Secret (API key / token)</FieldLabel>
              <SettingInput
                value={createSecret}
                onChange={(e) => setCreateSecret(e.target.value)}
                placeholder="Paste secret (stored encrypted)"
                disabled={loading || !canManage}
              />
              <div className="text-[11px] italic text-muted-foreground">
                Stored encrypted and never shown again.
              </div>
            </label>
          </div> as any
        }
        confirmText={loading ? "Creating…" : "Create"}
        confirmTag="save"
        cancelTag="cancel"
        onCancel={() => !loading && setCreateOpen(false)}
        onConfirm={() => void onCreateInstance()}
      />

      <ConfirmDialog
        open={!!confirm}
        title="Confirm"
        message={
          confirm?.kind === "instance"
            ? `Delete instance "${confirm.label}" ? This will also delete its endpoints.`
            : confirm?.kind === "endpoint"
            ? `Delete endpoint "${confirm.label}" ?`
            : confirm?.kind === "domain"
            ? `Delete allowlisted domain "${confirm.label}" ?`
            : ""
        }
        confirmText="Delete"
        onCancel={() => !loading && setConfirm(null)}
        onConfirm={async () => {
          if (!confirm || !canDelete || loading) return;
          setLoading(true);
          try {
            if (confirm.kind === "instance") {
              await deleteConnectorInstance(confirm.id);
              push({ kind: "success", title: "Instance deleted" });
            } else if (confirm.kind === "endpoint") {
              await deleteConnectorEndpoint(confirm.id);
              push({ kind: "success", title: "Endpoint deleted" });
            } else {
              await deleteAllowlistDomain(confirm.id);
              push({ kind: "success", title: "Domain deleted" });
            }
            setConfirm(null);
            await refreshAll();
          } catch (e: any) {
            push({
              kind: "error",
              title: "Error",
              message: String(
                e?.response?.data?.detail ?? e?.response?.status ?? "network"
              ),
            });
          } finally {
            setLoading(false);
          }
        }}
      />
    </div>
  );
}