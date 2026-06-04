import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Play, RefreshCw, PlugZap, CancelButton } from "../../components/ui/IconButton";
import Card from "../ui/Card";
import { useToast } from "../ui/toast";
import {
  listConnectorResults,
  runConnectorAction,
  type ConnectorTargetType,
  type ConnectorTarget,
  type ConnectorInstance,
} from "../../api/connectors";



type EndpointLite = {
  instance_id: string;
  instance_name: string;
  endpoint_id: string;
  label: string;
  name: string;
  target_type: string;
  method: string;
  base_url: string;
  path_template: string;
  is_enabled: boolean;
};

function safeJsonStringify(value: any) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function stringifyTableValue(value: any) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return safeJsonStringify(value);
}

function flattenForTable(value: any, prefix = ""): { key: string; value: string }[] {
  if (value === null || value === undefined) {
    return prefix ? [{ key: prefix, value: "" }] : [];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return prefix ? [{ key: prefix, value: "[]" }] : [];

    return value.flatMap((item, index) =>
      flattenForTable(item, prefix ? `${prefix}[${index}]` : `[${index}]`)
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return prefix ? [{ key: prefix, value: "{}" }] : [];

    return entries.flatMap(([key, item]) =>
      flattenForTable(item, prefix ? `${prefix}.${key}` : key)
    );
  }

  return [{ key: prefix || "value", value: stringifyTableValue(value) }];
}

function FieldLabel({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </label>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = String(status || "").toLowerCase();

  const tone =
    normalized === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
      : normalized === "running" || normalized === "queued"
      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
      : "border-destructive/20 bg-destructive/10 text-destructive";

  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
        tone,
      ].join(" ")}
    >
      {status}
    </span>
  );
}


function ResultPayloadDetails(props: {
  result: any;
  resultRaw: Record<string, boolean>;
  setResultRaw: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const rid = String(props.result.id || "");
  const raw = !!props.resultRaw[rid];
  const tableRows = flattenForTable(props.result.response_payload);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-muted-foreground">
          Response payload
        </div>

        <button
          type="button"
          className="rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
          onClick={() =>
            props.setResultRaw((prev) => ({ ...prev, [rid]: !prev[rid] }))
          }
        >
          {raw ? "Parsed view" : "Raw JSON"}
        </button>
      </div>

      {raw ? (
        <pre className="mt-3 max-h-[320px] overflow-auto rounded-2xl border border-border bg-card p-3 text-[11px] text-foreground">
          {safeJsonStringify(props.result.response_payload)}
        </pre>
      ) : (
        <div className="mt-3 max-h-[320px] overflow-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border">
                <th className="w-[45%] p-3 text-left font-semibold text-muted-foreground">
                  Key
                </th>
                <th className="p-3 text-left font-semibold text-muted-foreground">
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={2}>
                    No data
                  </td>
                </tr>
              ) : (
                tableRows.map((row, index) => (
                  <tr
                    key={`${row.key}-${index}`}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="p-3 align-top break-words text-foreground">
                      {row.key}
                    </td>
                    <td className="whitespace-pre-wrap break-words p-3 text-foreground">
                      {row.value}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


function endpointMatchesTarget(
  endpointTargetType: string | undefined,
  targetType: ConnectorTargetType
) {
  const value = String(endpointTargetType || "");
  return value === targetType || value === "case";
}


export default function ConnectorRunnerDrawer(props: {
  open: boolean;
  onClose: () => void;
  caseId: string;
  targetType: ConnectorTargetType;
  targets: ConnectorTarget[];
  instances: ConnectorInstance[];
}) {
  const { push } = useToast();
  const { open, onClose, caseId, targetType, targets, instances } = props;

  const endpoints: EndpointLite[] = useMemo(() => {
    const out: EndpointLite[] = [];
    for (const inst of instances ?? []) {
      if (!inst.is_enabled) continue;
      for (const ep of inst.endpoints ?? []) {
        if (!ep.is_enabled) continue;
        if (!endpointMatchesTarget(ep.target_type, targetType)) continue;
        out.push({
          instance_id: inst.id,
          instance_name: inst.name,
          endpoint_id: ep.id,
          label: ep.label || ep.name,
          name: ep.name,
          target_type: ep.target_type,
          method: ep.method,
          base_url: ep.base_url,
          path_template: ep.path_template,
          is_enabled: ep.is_enabled,
        });
      }
    }
    return out.sort(
      (a, b) =>
        a.instance_name.localeCompare(b.instance_name) ||
        a.label.localeCompare(b.label)
    );
  }, [instances, targetType]);

  const [selectedKey, setSelectedKey] = useState<string>("");
  const selected = useMemo(() => {
    if (!selectedKey) return null;
    const [instance_id, endpoint_id] = selectedKey.split("::");
    return (
      endpoints.find(
        (x) => x.instance_id === instance_id && x.endpoint_id === endpoint_id
      ) || null
    );
  }, [selectedKey, endpoints]);


  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [resultsBusy, setResultsBusy] = useState(false);
  const [resultRaw, setResultRaw] = useState<Record<string, boolean>>({});

  const targetFingerprint = useMemo(
    () =>
      (targets ?? [])
        .map((target) => `${String(target.key ?? "")}\u0001${String(target.value ?? "")}`)
        .join("\u0002"),
    [targets]
  );

  const normalizedTargets = useMemo<ConnectorTarget[]>(
    () =>
      (targets ?? []).map((target) => ({
        ...target,
        key: String(target.key ?? ""),
        value: String(target.value ?? ""),
      })),
    [targetFingerprint]
  );

  const refreshResults = useCallback(
    async (expectedResultIds: string[] = [], attempts = 1) => {
      if (!open) return;
      if (!caseId || !targetType || normalizedTargets.length === 0) {
        setResults([]);
        return;
      }

      const expected = new Set(expectedResultIds.map((id) => String(id)));

      setResultsBusy(true);
      try {
        let nextResults: any[] = [];

        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const grouped = await Promise.all(
            normalizedTargets.map(async (target) => {
              const rows = await listConnectorResults({
                case_id: caseId,
                target_type: targetType,
                target_key: target.key,
                target_value: target.value,
              });

              return (rows ?? []).map((row: any) => ({
                ...row,
                __target_key: target.key,
                __target_value: target.value,
              }));
            })
          );

          nextResults = grouped
            .flat()
            .sort(
              (a, b) =>
                new Date(b.created_at || 0).getTime() -
                new Date(a.created_at || 0).getTime()
            );

          setResults(nextResults);

          if (
            expected.size === 0 ||
            expectedResultIds.every((id) =>
              nextResults.some((row) => String(row.id) === String(id))
            )
          ) {
            break;
          }

          if (attempt < attempts - 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 500));
          }
        }
      } catch {
        setResults([]);
      } finally {
        setResultsBusy(false);
      }
    },
    [open, caseId, targetType, normalizedTargets]
  );

  useEffect(() => {
    if (open) {
      setSelectedKey("");
      void refreshResults();
    } else {
      setResults([]);
    }
  }, [open, refreshResults]);



  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, busy]);

  async function run() {
    if (!selected) return;
    if (!normalizedTargets.length) return;

    setBusy(true);
    try {
      const resp = await runConnectorAction({
        case_id: caseId,
        connector_instance_id: selected.instance_id,
        endpoint_id: selected.endpoint_id,
        target_type: targetType,
        targets: normalizedTargets,
        context: {},
      });

      if (resp.status === "success") {
        push({
          kind: "success",
          title: "Action launched",
          message: `${resp.connector_result_ids?.length ?? 0} result(s)`,
        });
      } else {
        push({
          kind: "error",
          title: "Action failed",
          message: `HTTP ${resp.http_status}`,
        });
      }

      await refreshResults(
        (resp.connector_result_ids ?? []).map((id: any) => String(id)),
        6
      );
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ??
            e?.response?.status ??
            e?.message ??
            "network"
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[110] m-0 appearance-none rounded-none border-0 bg-background/50 p-0 outline-none backdrop-blur-[2px]"
        onClick={() => !busy && onClose()}
        aria-label="Close connector drawer"
      />

      <aside className="fixed right-0 top-0 z-[111] flex h-screen w-full max-w-[720px] flex-col border-l border-border bg-card/95 shadow-2xl backdrop-blur-2xl">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-background text-foreground shadow-sm">
                  <PlugZap className="h-5 w-5" />
                </div>

                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">
                    Connector actions
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {targetType.toUpperCase()} • {targets.length} selected
                    {targets.length === 1
                      ? ` • ${targets[0].key}: ${targets[0].value}`
                      : ""}
                  </div>
                </div>
              </div>
            </div>

            <CancelButton
              type="button"
              onClick={onClose}
              disabled={busy}
              title="Close"
              aria-label="Close"
            >
            </CancelButton>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            <Card className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Run endpoint
                  </div>
                  <div className="mt-1 italic text-xs text-muted-foreground">
                    Launch a connector on the selected target
                    scope.
                  </div>
                </div>
              </div>

              {endpoints.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-border bg-background px-4 py-5 text-sm text-muted-foreground">
                  No enabled endpoint available for this selection.
                </div>
              ) : (
                <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_180px]">
                  <div className="min-w-0">
                    <FieldLabel>Endpoint</FieldLabel>
                    <select
                      className="h-11 w-full cursor-pointer rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                      value={selectedKey}
                      onChange={(e) => setSelectedKey(e.target.value)}
                      disabled={busy}
                    >
                      <option value="">— Select</option>
                      {endpoints.map((e) => (
                        <option
                          key={`${e.instance_id}::${e.endpoint_id}`}
                          value={`${e.instance_id}::${e.endpoint_id}`}
                        >
                          {e.instance_name} • {e.label}
                          {e.target_type === "case" ? " • Generic" : ""}
                        </option>
                      ))}
                    </select>

                    {selected ? (
                      <div className="mt-3 rounded-2xl border border-border bg-background/70 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Connector endpoint
                        </div>
                        <div className="mt-1 break-all text-xs text-foreground">
                          <span className="font-medium">{selected.method}</span>{" "}
                          {selected.base_url}
                          {selected.path_template}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-end">
                    <button
                      className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-border bg-slate-800 px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={busy || !selected || targets.length === 0}
                      onClick={run}
                      type="button"
                    >
                      <Play className="h-4 w-4" />
                      <span>{busy ? "Running…" : `Run on ${targets.length}`}</span>
                    </button>
                  </div>
                </div>
              )}
            </Card>

            <Card className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Results
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    History for the selected target{normalizedTargets.length > 1 ? "s" : ""}.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void refreshResults()}
                  disabled={resultsBusy || busy}
                  className="inline-flex cursor-pointer h-10 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw
                    className={[
                      "h-4 w-4",
                      resultsBusy ? "animate-spin" : "",
                    ].join(" ")}
                  />
                  <span>{resultsBusy ? "Refreshing…" : "Refresh"}</span>
                </button>
              </div>

              {resultsBusy ? (
                <div className="mt-4 space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-24 animate-pulse rounded-2xl bg-muted"
                    />
                  ))}
                </div>
              ) : results.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-border bg-background px-4 py-5 text-sm text-muted-foreground">
                  No result yet for this selection.
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {results.map((r) => (
                    <details
                      key={r.id}
                      className="group rounded-2xl border border-border bg-background/70"
                    >
                      <summary className="cursor-pointer list-none p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            {normalizedTargets.length > 1 ? (
                              <div className="mb-2 inline-flex max-w-full items-center rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                <span className="truncate">
                                  {String(r.__target_key || "—")}: {String(r.__target_value || "—")}
                                </span>
                              </div>
                            ) : null}

                            <div className="truncate text-sm font-semibold text-foreground">
                              {r.action_id}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {new Date(r.created_at).toLocaleString()}
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-3">
                            <StatusPill status={String(r.status || "unknown")} />
                            <span className="text-xs font-medium text-muted-foreground transition group-open:rotate-180">
                              ⌄
                            </span>
                          </div>
                        </div>
                      </summary>

                      <div className="px-4 pb-4">
                        {r.error ? (
                          <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs whitespace-pre-wrap break-words text-destructive">
                            {String(r.error)}
                          </div>
                        ) : null}

                        <ResultPayloadDetails
                          result={r}
                          resultRaw={resultRaw}
                          setResultRaw={setResultRaw}
                        />
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </aside>
    </>,
    document.body
  );
}