import { useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "../../../contexts/MeContext";
import Card from "../../../components/ui/Card";
import { useToast } from "../../../components/ui/toast";
import { listAuditLogs, type AuditLogItem } from "../../../api/settingsAudit";
import {
  LeftButton,
  RefreshButton,
  RightButton,
} from "../../../components/ui/IconButton";


function FieldLabel({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </div>
  );
}

function SettingInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none transition",
        "placeholder:text-muted-foreground",
        "focus:border-ring focus:ring-2 focus:ring-ring/20",
        "disabled:cursor-not-allowed disabled:opacity-60",
        props.className || "",
      ].join(" ")}
    />
  );
}

function SettingSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={[
        "h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none transition",
        "focus:border-ring focus:ring-2 focus:ring-ring/20",
        "disabled:cursor-not-allowed disabled:opacity-60",
        props.className || "",
      ].join(" ")}
    />
  );
}

function StatPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function fmtDate(s?: string) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleString();
}

function prettyMeta(m: any) {
  if (m == null) return "—";
  try {
    const s = JSON.stringify(m, null, 2);
    if (!s || s === "{}") return "—";
    return s;
  } catch {
    return String(m);
  }
}

function isEmptyMeta(m: any) {
  if (m == null) return true;
  try {
    if (typeof m === "object" && !Array.isArray(m)) {
      return Object.keys(m || {}).length === 0;
    }
    return false;
  } catch {
    return false;
  }
}

type ColKey =
  | "created_at"
  | "actor_username"
  | "action"
  | "success"
  | "status_code"
  | "object_type"
  | "object_id"
  | "method"
  | "path"
  | "ip_address"
  | "user_agent"
  | "metadata";

const COLS: {
  key: ColKey;
  label: string;
  defaultWide: boolean;
  defaultNarrow: boolean;
}[] = [
  { key: "created_at", label: "Created", defaultWide: true, defaultNarrow: true },
  { key: "actor_username", label: "Actor", defaultWide: true, defaultNarrow: true },
  { key: "action", label: "Action", defaultWide: true, defaultNarrow: true },
  { key: "success", label: "Success", defaultWide: true, defaultNarrow: true },
  { key: "status_code", label: "Status", defaultWide: true, defaultNarrow: true },
  { key: "object_type", label: "Object type", defaultWide: true, defaultNarrow: true },
  { key: "object_id", label: "Object id", defaultWide: true, defaultNarrow: false },
  { key: "method", label: "Method", defaultWide: true, defaultNarrow: true },
  { key: "path", label: "Path", defaultWide: true, defaultNarrow: true },
  { key: "ip_address", label: "IP", defaultWide: true, defaultNarrow: false },
  { key: "user_agent", label: "User agent", defaultWide: true, defaultNarrow: false },
  { key: "metadata", label: "Metadata", defaultWide: true, defaultNarrow: false },
];

const LS_KEY = "doko.audit.columns.v2";

function loadVisibleCols(): Record<ColKey, boolean> | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const out: any = {};
    for (const c of COLS) out[c.key] = Boolean((parsed as any)[c.key]);
    return out as Record<ColKey, boolean>;
  } catch {
    return null;
  }
}

function saveVisibleCols(v: Record<ColKey, boolean>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(v));
  } catch {
    // ignore
  }
}

function defaultVisibleCols(): Record<ColKey, boolean> {
  const w = typeof window !== "undefined" ? window.innerWidth : 1400;
  const wide = w >= 1100;
  const out: any = {};
  for (const c of COLS) out[c.key] = wide ? c.defaultWide : c.defaultNarrow;
  return out as Record<ColKey, boolean>;
}

function cellWrapClass(k: ColKey) {
  if (k === "metadata") return "whitespace-pre-wrap break-words";
  if (k === "user_agent" || k === "path" || k === "object_id") {
    return "break-all";
  }
  return "break-words";
}

function headerWidthClass(k: ColKey) {
  switch (k) {
    case "created_at":
      return "min-w-[160px]";
    case "actor_username":
      return "min-w-[120px]";
    case "action":
      return "min-w-[180px]";
    case "success":
      return "min-w-[90px]";
    case "status_code":
      return "min-w-[90px]";
    case "object_type":
      return "min-w-[120px]";
    case "object_id":
      return "min-w-[180px]";
    case "method":
      return "min-w-[90px]";
    case "path":
      return "min-w-[220px]";
    case "ip_address":
      return "min-w-[140px]";
    case "user_agent":
      return "min-w-[260px]";
    case "metadata":
      return "min-w-[320px]";
    default:
      return "min-w-[120px]";
  }
}

function ColumnsPicker(props: {
  value: Record<ColKey, boolean>;
  onChange: (next: Record<ColKey, boolean>) => void;
  disabled?: boolean;
}) {
  const { value, onChange, disabled } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!open) return;
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const anyShown = useMemo(() => COLS.some((c) => value[c.key]), [value]);

  const toggle = (k: ColKey) => {
    const next = { ...value, [k]: !value[k] };
    const stillAny = COLS.some((c) => next[c.key]);
    onChange(stillAny ? next : value);
  };

  const selectAll = () => {
    const next: any = {};
    for (const c of COLS) next[c.key] = true;
    onChange(next as Record<ColKey, boolean>);
  };

  const reset = () => onChange(defaultVisibleCols());

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((x) => !x)}
        className={[
          "rounded-2xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition",
          "hover:bg-accent disabled:opacity-60",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
        title="Choose visible columns"
      >
        Columns
      </button>

      {open && !disabled ? (
        <div className="absolute right-0 z-50 mt-2 w-[280px] overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 p-3">
            <button
              type="button"
              className="rounded-xl border border-border bg-card px-3 py-2 text-[11px] font-medium text-foreground transition hover:bg-accent"
              onClick={reset}
            >
              Reset
            </button>

            <button
              type="button"
              className="rounded-xl border border-border bg-card px-3 py-2 text-[11px] font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
              onClick={selectAll}
              disabled={!anyShown}
            >
              Select all
            </button>
          </div>

          <div className="max-h-72 overflow-auto p-2 space-y-1">
            {COLS.map((c) => (
              <label
                key={c.key}
                className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 transition hover:bg-accent/50 select-none"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={Boolean(value[c.key])}
                  onChange={() => toggle(c.key)}
                />
                <span className="truncate text-xs text-foreground" title={c.label}>
                  {c.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function SettingsAudit() {
  const { push } = useToast();
  const me = useMe();
  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canView = can("settings.audit.view");

  const [loading, setLoading] = useState(false);
  const [busy] = useState(false);

  const [qDraft, setQDraft] = useState("");
  const [actionDraft, setActionDraft] = useState("");
  const [objectTypeDraft, setObjectTypeDraft] = useState("");

  const [q, setQ] = useState("");
  const [success, setSuccess] = useState<string>("");
  const [action, setAction] = useState("");
  const [objectType, setObjectType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQ(qDraft.trim()), 300);
    return () => clearTimeout(t);
  }, [qDraft]);

  useEffect(() => {
    const t = setTimeout(() => setAction(actionDraft.trim()), 300);
    return () => clearTimeout(t);
  }, [actionDraft]);

  useEffect(() => {
    const t = setTimeout(() => setObjectType(objectTypeDraft.trim()), 300);
    return () => clearTimeout(t);
  }, [objectTypeDraft]);

  useEffect(() => {
    setPage(1);
  }, [q, success, action, objectType, dateFrom, dateTo]);

  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [count, setCount] = useState<number>(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [visibleCols, setVisibleCols] = useState<Record<ColKey, boolean>>(() => {
    const stored = loadVisibleCols();
    return stored ?? defaultVisibleCols();
  });

  useEffect(() => {
    saveVisibleCols(visibleCols);
  }, [visibleCols]);

  const show = (k: ColKey) => Boolean(visibleCols[k]);

  async function refresh() {
    if (!canView) {
      setItems([]);
      setCount(0);
      return;
    }
    setLoading(true);
    try {
      const r = await listAuditLogs({
        q: q || undefined,
        success: success || undefined,
        action: action || undefined,
        object_type: objectType || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        ordering: "-created_at",
        page,
      });
      setItems(r.results ?? []);
      setCount(r.count ?? 0);
    } catch (e: any) {
      setItems([]);
      setCount(0);
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canView) {
      setItems([]);
      setCount(0);
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, success, action, objectType, dateFrom, dateTo, page, canView]);

  const visibleColumnCount = useMemo(
    () => COLS.filter((c) => visibleCols[c.key]).length,
    [visibleCols]
  );

  const totalPages = Math.max(
    1,
    Math.ceil((Number(count) || 0) / pageSize)
  );

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);
  
  if (!canView) {
    return (
      <div className="space-y-3">
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          Audit
        </div>
        <div className="text-sm text-muted-foreground">Access denied.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between min-w-0">
        <div className="min-w-0">
          <div className="text-3xl font-semibold tracking-tight text-foreground">
            Audit
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Review platform activity, user actions and audit metadata.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatPill>{count} events</StatPill>
          <StatPill>{visibleColumnCount} columns visible</StatPill>
        </div>
      </div>

      <Card className="p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_160px_180px_170px_170px_170px] xl:items-end">
          <label className="block space-y-2 xl:col-span-1">
            <FieldLabel>Search</FieldLabel>
            <SettingInput
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              placeholder="actor, action, object, metadata..."
            />
          </label>

          <label className="block space-y-2">
            <FieldLabel>Success</FieldLabel>
            <SettingSelect
              value={success}
              onChange={(e) => setSuccess(e.target.value)}
            >
              <option value="">All</option>
              <option value="true">Success</option>
              <option value="false">Fail</option>
            </SettingSelect>
          </label>

          <label className="block space-y-2">
            <FieldLabel>Action</FieldLabel>
            <SettingInput
              value={actionDraft}
              onChange={(e) => setActionDraft(e.target.value)}
              placeholder="ex: settings.request"
            />
          </label>

          <label className="block space-y-2">
            <FieldLabel>Object type</FieldLabel>
            <SettingInput
              value={objectTypeDraft}
              onChange={(e) => setObjectTypeDraft(e.target.value)}
              placeholder="ex: case"
            />
          </label>

          <label className="block space-y-2">
            <FieldLabel>From</FieldLabel>
            <SettingInput
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>

          <label className="block space-y-2">
            <FieldLabel>To</FieldLabel>
            <SettingInput
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">Audit events</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Use the column picker to adapt the table to your screen.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Page {page} / {totalPages}
            </span>

            <div className="flex items-center gap-1">
              <LeftButton
                disabled={loading || busy || page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                title="Previous"
              />
              <RightButton
                disabled={loading || busy || page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                title="Next"
              />
            </div>

            <ColumnsPicker
              value={visibleCols}
              onChange={setVisibleCols}
              disabled={loading || busy}
            />

            <RefreshButton
              disabled={loading || busy}
              onClick={() => void refresh()}
              title="Refresh table"
              iconOnly={false}
              label={loading ? "Loading..." : "Refresh"}
            />
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="h-12 w-full animate-pulse rounded-2xl bg-muted"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-10 text-center text-sm text-muted-foreground">
            No audit events.
          </div>
        ) : (
          <div className="min-w-0 overflow-hidden rounded-2xl border border-border bg-background">
            <div className="max-w-full overflow-x-auto">
              <table className="w-max min-w-full table-auto border-collapse text-left text-sm">
                <thead className="border-b border-border bg-muted/40">
                  <tr className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {show("created_at") && (
                      <th className={`px-4 py-3 ${headerWidthClass("created_at")}`}>
                        Created
                      </th>
                    )}
                    {show("actor_username") && (
                      <th className={`px-4 py-3 ${headerWidthClass("actor_username")}`}>
                        Actor
                      </th>
                    )}
                    {show("action") && (
                      <th className={`px-4 py-3 ${headerWidthClass("action")}`}>
                        Action
                      </th>
                    )}
                    {show("success") && (
                      <th className={`px-4 py-3 ${headerWidthClass("success")}`}>
                        Success
                      </th>
                    )}
                    {show("status_code") && (
                      <th className={`px-4 py-3 ${headerWidthClass("status_code")}`}>
                        Status
                      </th>
                    )}
                    {show("object_type") && (
                      <th className={`px-4 py-3 ${headerWidthClass("object_type")}`}>
                        Object type
                      </th>
                    )}
                    {show("object_id") && (
                      <th className={`px-4 py-3 ${headerWidthClass("object_id")}`}>
                        Object id
                      </th>
                    )}
                    {show("method") && (
                      <th className={`px-4 py-3 ${headerWidthClass("method")}`}>
                        Method
                      </th>
                    )}
                    {show("path") && (
                      <th className={`px-4 py-3 ${headerWidthClass("path")}`}>
                        Path
                      </th>
                    )}
                    {show("ip_address") && (
                      <th className={`px-4 py-3 ${headerWidthClass("ip_address")}`}>
                        IP
                      </th>
                    )}
                    {show("user_agent") && (
                      <th className={`px-4 py-3 ${headerWidthClass("user_agent")}`}>
                        User agent
                      </th>
                    )}
                    {show("metadata") && (
                      <th className={`px-4 py-3 ${headerWidthClass("metadata")}`}>
                        Metadata
                      </th>
                    )}
                  </tr>
                </thead>

                <tbody className="divide-y divide-border">
                  {items.map((x) => {
                    const metaStr = prettyMeta(x.metadata);
                    const showMeta = metaStr !== "—" && !isEmptyMeta(x.metadata);

                    return (
                      <tr
                        key={x.id}
                        className="align-top transition hover:bg-accent/20"
                      >
                        {show("created_at") && (
                          <td className="px-4 py-3 text-xs text-foreground">
                            <div
                              className={cellWrapClass("created_at")}
                              title={fmtDate(x.created_at)}
                            >
                              {fmtDate(x.created_at)}
                            </div>
                          </td>
                        )}

                        {show("actor_username") && (
                          <td className="px-4 py-3 text-sm text-foreground">
                            <div
                              className={cellWrapClass("actor_username")}
                              title={x.actor_username || ""}
                            >
                              {x.actor_username || "—"}
                            </div>
                          </td>
                        )}

                        {show("action") && (
                          <td className="px-4 py-3 text-xs">
                            <div
                              className={`font-semibold text-foreground ${cellWrapClass("action")}`}
                              title={x.action}
                            >
                              {x.action}
                            </div>
                          </td>
                        )}

                        {show("success") && (
                          <td className="px-4 py-3">
                            <span
                              className={[
                                "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                                x.success
                                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                  : "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400",
                              ].join(" ")}
                            >
                              {x.success ? "OK" : "FAIL"}
                            </span>
                          </td>
                        )}

                        {show("status_code") && (
                          <td className="px-4 py-3 font-mono text-[11px] text-foreground">
                            <div
                              className={cellWrapClass("status_code")}
                              title={x.status_code ? String(x.status_code) : ""}
                            >
                              {x.status_code ? `${x.status_code}` : "—"}
                            </div>
                          </td>
                        )}

                        {show("object_type") && (
                          <td className="px-4 py-3 text-xs text-foreground">
                            <div
                              className={cellWrapClass("object_type")}
                              title={x.object_type || ""}
                            >
                              {x.object_type || "—"}
                            </div>
                          </td>
                        )}

                        {show("object_id") && (
                          <td className="px-4 py-3 font-mono text-[11px] text-foreground">
                            <div
                              className={cellWrapClass("object_id")}
                              title={x.object_id ? String(x.object_id) : ""}
                            >
                              {x.object_id ? String(x.object_id) : "—"}
                            </div>
                          </td>
                        )}

                        {show("method") && (
                          <td className="px-4 py-3 font-mono text-[11px] text-foreground">
                            <div
                              className={cellWrapClass("method")}
                              title={x.method || ""}
                            >
                              {x.method || "—"}
                            </div>
                          </td>
                        )}

                        {show("path") && (
                          <td className="px-4 py-3 font-mono text-[11px] text-foreground">
                            <div
                              className={cellWrapClass("path")}
                              title={x.path || ""}
                            >
                              {x.path || "—"}
                            </div>
                          </td>
                        )}

                        {show("ip_address") && (
                          <td className="px-4 py-3 font-mono text-[11px] text-foreground">
                            <div
                              className={cellWrapClass("ip_address")}
                              title={x.ip_address || ""}
                            >
                              {x.ip_address || "—"}
                            </div>
                          </td>
                        )}

                        {show("user_agent") && (
                          <td className="px-4 py-3 font-mono text-[10px] text-foreground">
                            <div
                              className={cellWrapClass("user_agent")}
                              title={x.user_agent || ""}
                            >
                              {x.user_agent || "—"}
                            </div>
                          </td>
                        )}

                        {show("metadata") && (
                          <td className="px-4 py-3">
                            {showMeta ? (
                              <pre className="max-h-56 overflow-auto rounded-xl border border-border bg-card p-3 font-mono text-[11px] text-foreground whitespace-pre-wrap break-words">
                                {metaStr}
                              </pre>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}