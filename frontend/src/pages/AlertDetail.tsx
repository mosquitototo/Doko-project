import { useEffect, useState, useRef, type ReactNode } from "react";
import { Link, useParams, useNavigate, useLocation } from "react-router-dom";
import Card from "../components/ui/Card";
import StatusBadge from "../components/ui/StatusBadge";
import SeverityBadge from "../components/ui/SeverityBadge";
import ClassificationBadge from "../components/ui/ClassificationBadge";
import OutcomeBadge from "../components/ui/OutcomeBadge";
import { fetchAlertDetail, type AlertDetail as AlertDetailType } from "../api/alerts";
import { fetchUsersLite, type UserLite } from "../api/usersLite";
import { updateAlert } from "../api/alerts";
import { useToast } from "../components/ui/toast";
import AlertMergeDialog from "../components/ui/AlertMergeDialog";
import { escalateAlert, mergeAlertIntoCase, deleteAlert } from "../api/alertsActions";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { useMe } from "../contexts/MeContext";
import { listCustomers, type Customer } from "../api/settingsCustomers";
import KeyValueEditor from "../components/ui/KeyValueEditor";
import {
  listSeverities,
  listClassifications,
  type SeverityItem,
  type ClassificationItem,
} from "../api/dataModels";
import {
  listAlertComments,
  addAlertComment,
  updateAlertComment,
  deleteAlertComment,
  type AlertComment,
} from "../api/alertDetail";
import {
  MergeButton,
  DeleteButton,
  NewGenButton,
  SaveButton,
  OpenCloseToggleButton,
  EditGenButton,
  CancelButton,
  Workflow,
  NotebookText,
  Info,
  UserRound,
  Activity,
  LeftButton,
} from "../components/ui/IconButton";
import MarkdownEditor from "../components/ui/MarkdownEditor";
import MarkdownRenderedContent from "../components/ui/MarkdownRenderedContent";


type KVRow = {
  field?: string;
  value?: string;
  type?: string;
  status?: string;
};

type CsvRow = {
  field: string;
  value: string;
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function asString(v: any): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  if (typeof v === "object") {
    if ("value" in v) return String((v as any).value ?? "");
    if ("code" in v) return String((v as any).code ?? "");
    return "";
  }
  return String(v);
}

function richTextToPlainText(html: string) {
  if (!html) return "";
  const el = document.createElement("div");
  el.innerHTML = html;
  return (el.textContent || el.innerText || "").replace(/\u00a0/g, " ").trim();
}

function isRichTextEmpty(html: string) {
  return richTextToPlainText(html) === "";
}

function normalizeField(row: KVRow) {
  return String(row.field ?? row.type ?? "").trim();
}

function normalizeValue(row: KVRow) {
  return String(row.value ?? "").trim();
}

function normalizeStatus(row: KVRow) {
  return String(row.status ?? "").trim();
}

function rowKey(field: string, value: string) {
  return `${field.trim().toLowerCase()}::${value.trim().toLowerCase()}`;
}

function escapeCsvCell(value: string) {
  const v = String(value ?? "");
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function buildFieldValueCsv(rows: KVRow[]) {
  const lines = ["field,value"];
  for (const row of rows || []) {
    const field = normalizeField(row);
    const value = normalizeValue(row);
    if (!field && !value) continue;
    lines.push(`${escapeCsvCell(field)},${escapeCsvCell(value)}`);
  }
  return `${lines.join("\r\n")}\r\n`;
}

function parseCsvLine(line: string) {
  const out: string[] = [];
  let current = "";
  let i = 0;
  let inQuotes = false;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === `"`) {
        if (line[i + 1] === `"`) {
          current += `"`;
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (ch === `"`) {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ",") {
      out.push(current);
      current = "";
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  out.push(current);
  return out;
}

function parseFieldValueCsv(text: string): CsvRow[] {
  const clean = String(text ?? "").replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((line) => line.trim() !== "");

  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((x) => x.trim().toLowerCase());
  if (header.length !== 2 || header[0] !== "field" || header[1] !== "value") {
    throw new Error('Invalid CSV header. Expected exactly: field,value');
  }

  const out: CsvRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length > 2) {
      throw new Error(`Invalid CSV row at line ${i + 1}. Expected exactly 2 columns.`);
    }
    const field = String(cols[0] ?? "").trim();
    const value = String(cols[1] ?? "").trim();
    if (!field && !value) continue;
    out.push({ field, value });
  }

  if (out.length > 5000) {
    throw new Error("Too many rows in CSV. Maximum is 5000.");
  }

  return out;
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function mergeImportedRows(currentRows: KVRow[], importedRows: CsvRow[]) {
  const merged = (currentRows || []).map((row) => ({
    field: normalizeField(row),
    value: normalizeValue(row),
    status: normalizeStatus(row),
  }));

  const seen = new Set(merged.map((row) => rowKey(row.field, row.value)));
  let added = 0;

  for (const row of importedRows) {
    const field = String(row.field ?? "").trim();
    const value = String(row.value ?? "").trim();
    if (!field && !value) continue;
    const key = rowKey(field, value);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      field,
      value,
      status: "",
    });
    added += 1;
  }

  return { merged, added };
}

function TinyCsvButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      className="inline-flex h-8 items-center rounded-xl border border-border bg-background px-2.5 text-[11px] font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      {props.label}
    </button>
  );
}

function InlineEditableBadge(props: {
  value: string;
  onChange: (next: string) => void | Promise<void>;
  disabled?: boolean;
  options: { value: string; label: string }[];
  display: ReactNode;
  ariaLabel: string;
  menuAlign?: "left" | "right";
}) {
  const { value, onChange, disabled, options, display, ariaLabel, menuAlign = "left" } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setOpen(false);
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex items-center">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        className={[
          "inline-flex border-none bg-transparent items-center rounded-xl transition",
          disabled
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer hover:scale-[1.05] focus:outline-none focus:ring-ring/20",
        ].join(" ")}
      >
        {display}
      </button>

      {open && !disabled ? (
        <div
          className={[
            "absolute top-full z-50 mt-2 min-w-[220px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-card shadow-panel",
            menuAlign === "right" ? "right-0" : "left-0",
          ].join(" ")}
        >
          <div className="max-h-72 overflow-auto p-1.5">
            {options.map((option) => {
              const selected = option.value === value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={async () => {
                    setOpen(false);
                    if (option.value !== value) {
                      await onChange(option.value);
                    }
                  }}
                  className={[
                    "flex w-full border-none bg-transparent cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition",
                    selected
                      ? "bg-accent border-none bg-transparent text-accent-foreground"
                      : "text-foreground border-none bg-transparent hover:bg-accent/60",
                  ].join(" ")}
                >
                  <span>{option.label}</span>
                  {selected ? (
                    <span className="text-xs text-muted-foreground">Selected</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InlineTextBadge(props: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground shadow-sm">
      {props.children}
    </span>
  );
}

function SlaBadge({ state }: { state?: string | null }) {
  const normalized = String(state || "").trim();

  if (!normalized || normalized === "none" || normalized === "completed") return null;

  const isOverdue = normalized === "overdue";
  const isOverdueCompleted = normalized === "overdue_completed";

  if (!isOverdue && !isOverdueCompleted) return null;

  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium shadow-sm",
        isOverdue
          ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400"
          : "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      ].join(" ")}
      title={
        isOverdue
          ? "SLA exceeded"
          : "SLA exceeded before acknowledgement"
      }
    >
      SLA
    </span>
  );
}

const outcomeOptions = [
  { value: "unknown", label: "Unknown" },
  { value: "true_positive_with_impact", label: "TP with impact" },
  { value: "true_positive_without_impact", label: "TP no impact" },
  { value: "false_positive_technical", label: "FP Technical" },
  { value: "false_positive", label: "False positive" },
  { value: "legitimate", label: "Legitimate" },
  { value: "not_applicable", label: "Not applicable" },
];

const IOC_STATUS_OPTIONS = [
  { value: "observed", label: "Observed" },
  { value: "suspicious", label: "Suspicious" },
  { value: "malicious", label: "Malicious" },
  { value: "legitimate", label: "Legitimate" },
  { value: "unknown", label: "Unknown" },
  { value: "to_check", label: "To check" },
];

const ASSET_STATUS_OPTIONS = [
  { value: "compromised", label: "Compromised" },
  { value: "not_compromised", label: "Not compromised" },
  { value: "unknown", label: "Unknown" },
  { value: "to_check", label: "To check" },
  { value: "observed", label: "Observed" },
  { value: "not_applicable", label: "N/A" },
];

export default function AlertDetail() {
  const { id } = useParams();
  const alertId = id || "";

  const navigate = useNavigate();
  const { push } = useToast();

  const me = useMe();
  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canMerge = can("alert.merge") || can("alert.escalate");
  const canUpdate = can("alert.update");
  const canDelete = can("alert.delete");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [sevOptions, setSevOptions] = useState<SeverityItem[]>([]);
  const [clsOptions, setClsOptions] = useState<ClassificationItem[]>([]);

  const [loading, setLoading] = useState(false);
  const [item, setItem] = useState<AlertDetailType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [mergeUI, setMergeUI] = useState<{ alertId: string } | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);
  const [confirmDeleteAlert, setConfirmDeleteAlert] = useState(false);

  const [comments, setComments] = useState<AlertComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [commentBusyId, setCommentBusyId] = useState<string | null>(null);
  const [confirmCommentDelete, setConfirmCommentDelete] = useState<string | null>(null);

  const [editDescription, setEditDescription] = useState("");
  const [descriptionActionsVisible, setDescriptionActionsVisible] = useState(false);
  const alertDescFocusedRef = useRef(false);
  const saveDescriptionInFlightRef = useRef(false);
  const saveDescriptionQueuedRef = useRef(false);
  const iocFileInputRef = useRef<HTMLInputElement | null>(null);
  const assetFileInputRef = useRef<HTMLInputElement | null>(null);

  const location = useLocation();

  useEffect(() => {
    sessionStorage.setItem(`doko:chat:tab:${location.pathname}`, "overview");
  }, [location.pathname]);

  useEffect(() => {
    listCustomers({ include_inactive: false })
      .then((r) => setCustomers(r.results ?? []))
      .catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    fetchUsersLite().then(setUsers).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([listSeverities(false), listClassifications(false)])
      .then(([s, c]) => {
        if (!mounted) return;
        setSevOptions((s ?? []).filter((x) => x.is_active));
        setClsOptions((c ?? []).filter((x) => x.is_active));
      })
      .catch(() => {
        if (!mounted) return;
        setSevOptions([]);
        setClsOptions([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function refreshAll() {
    if (!alertId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await fetchAlertDetail(alertId);
      setItem(d);

      if (!alertDescFocusedRef.current) {
        setEditDescription(d.description || "");
      }

      const c = await listAlertComments(alertId);
      setComments(c);
    } catch (e: any) {
      const status = e?.response?.status;
      const msg = status ? `API error (${status})` : "Network error";
      setError(msg);

      if (status === 404) {
        push({
          kind: "info",
          title: "Alert not found",
          message: "It may have been deleted.",
        });
        navigate("/alerts");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertId]);

  useEffect(() => {
    function onChatPosted(event: Event) {
      const detail = (event as CustomEvent<{
        pageType?: string;
        objectId?: string;
      }>).detail;

      if (!detail) return;
      if (detail.pageType !== "alert") return;
      if (String(detail.objectId || "") !== String(alertId || "")) return;

      void refreshAll();
    }

    window.addEventListener("doko:chat-posted", onChatPosted as EventListener);
    return () => {
      window.removeEventListener("doko:chat-posted", onChatPosted as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertId]);

  const alertStatusOptions = [
    { value: "open", label: "Open" },
    { value: "in_progress", label: "In progress" },
    { value: "merged", label: "Merged" },
    { value: "closed", label: "Closed" },
  ];

  async function changeAlertStatus(next: string) {
    if (!canUpdate) return;
    if (!alertId || !next) return;
    setBusyAction(true);
    try {
      await updateAlert(alertId, { status: next } as any);
      push({ kind: "success", title: "Status updated" });
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
      setBusyAction(false);
    }
  }

  async function changeAlertSeverity(nextCode: string) {
    if (!canUpdate) return;
    if (!alertId || !nextCode) return;
    setBusyAction(true);
    try {
      await updateAlert(alertId, { severity: nextCode } as any);
      push({ kind: "success", title: "Severity updated" });
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
      setBusyAction(false);
    }
  }

  async function changeAlertClassification(nextCode: string) {
    if (!canUpdate) return;
    if (!alertId || !nextCode) return;
    setBusyAction(true);
    try {
      await updateAlert(alertId, { classification: nextCode } as any);
      push({ kind: "success", title: "Classification updated" });
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
      setBusyAction(false);
    }
  }

  async function changeAlertOutcome(nextCode: string) {
    if (!canUpdate) return;
    if (!alertId || !nextCode) return;
    setBusyAction(true);
    try {
      await updateAlert(alertId, { outcome: nextCode } as any);
      push({ kind: "success", title: "Outcome updated" });
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
      setBusyAction(false);
    }
  }

  async function saveDescriptionIfDirty(description?: string) {
    if (!canUpdate) return;
    if (!alertId || !item) return;

    if (saveDescriptionInFlightRef.current) {
      saveDescriptionQueuedRef.current = true;
      return;
    }

    const nextDesc = description ?? editDescription ?? "";
    const currentDesc = item.description ?? "";

    if (nextDesc === currentDesc) {
      return;
    }

    saveDescriptionInFlightRef.current = true;
    setBusyAction(true);

    try {
      await updateAlert(alertId, { description: nextDesc } as any);

      setItem((prev) => (prev ? ({ ...prev, description: nextDesc } as any) : prev));
      setEditDescription(nextDesc);

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
      saveDescriptionInFlightRef.current = false;
      setBusyAction(false);

      if (saveDescriptionQueuedRef.current) {
        saveDescriptionQueuedRef.current = false;
        void saveDescriptionIfDirty(nextDesc);
      }
    }
  }

  async function saveDescriptionFromEditor() {
    await saveDescriptionIfDirty(editDescription ?? "");
    alertDescFocusedRef.current = false;
    setDescriptionActionsVisible(false);
  }

  function cancelDescriptionEdit() {
    setEditDescription(item?.description ?? "");
    alertDescFocusedRef.current = false;
    setDescriptionActionsVisible(false);
  }

  async function submitComment() {
    if (!alertId || !canUpdate) return;
    const text = commentText;
    if (isRichTextEmpty(text)) return;

    setBusyAction(true);
    try {
      await addAlertComment(alertId, text);
      push({ kind: "success", title: "Comment added" });
      setCommentText("");
      await refreshAll();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
    } finally {
      setBusyAction(false);
    }
  }

  function startEditComment(c: AlertComment) {
    setEditingCommentId(c.id);
    setEditingText(String(c.text ?? ""));
  }

  function cancelEditComment() {
    setEditingCommentId(null);
    setEditingText("");
  }

  async function saveEditComment(commentId: string) {
    if (!canUpdate) return;

    const next = editingText;

    if (isRichTextEmpty(next)) return;

    setCommentBusyId(commentId);

    try {
      await updateAlertComment(commentId, next);

      setComments((prev) =>
        prev.map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                text: next,
              }
            : comment
        )
      );

      push({ kind: "success", title: "Comment updated" });
      cancelEditComment();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
    } finally {
      setCommentBusyId(null);
    }
  }

  async function handleExport(kind: "iocs" | "assets") {
    const rows = ((item as any)?.[kind] || []) as KVRow[];
    const filename = kind === "iocs" ? "alert-iocs.csv" : "alert-assets.csv";
    const content = buildFieldValueCsv(rows);
    downloadCsv(filename, content);
    push({
      kind: "success",
      title: "CSV exported",
      message: `${rows.length} row${rows.length > 1 ? "s" : ""} exported`,
    });
  }

  async function handleImport(kind: "iocs" | "assets", file: File) {
    if (!alertId || !item || !file || !canUpdate) return;

    if (file.size > 2 * 1024 * 1024) {
      push({
        kind: "error",
        title: "Import failed",
        message: "CSV too large. Maximum size is 2 MB.",
      });
      return;
    }

    setBusyAction(true);
    try {
      const text = await file.text();
      const importedRows = parseFieldValueCsv(text);
      const currentRows = (((item as any)?.[kind] || []) as KVRow[]).map((row) => ({
        field: normalizeField(row),
        value: normalizeValue(row),
        status: normalizeStatus(row),
      }));
      const { merged, added } = mergeImportedRows(currentRows, importedRows);

      await updateAlert(alertId, { [kind]: merged } as any);
      push({
        kind: "success",
        title: "CSV imported",
        message:
          added > 0
            ? `${added} new row${added > 1 ? "s" : ""} added`
            : "No new row added",
      });
      await refreshAll();
    } catch (e: any) {
      const message =
        e instanceof Error
          ? e.message
          : String(e?.response?.data?.detail ?? e?.response?.status ?? "network");
      push({
        kind: "error",
        title: "Import failed",
        message,
      });
    } finally {
      setBusyAction(false);
    }
  }

  if (error) return <div className="text-red-600">{error}</div>;
  if (!item) return <div>Loading…</div>;

  const linkedCaseId = String((item as any)?.case ?? "").trim();
  const linkedCaseTitle = String((item as any)?.case_title ?? "").trim();
  const linkedCaseCustomerName = String((item as any)?.case_customer_name ?? "").trim();
  const safeStatus = linkedCaseId ? "merged" : asString((item as any)?.status);
  const safeSeverity = asString((item as any)?.severity);
  const safeClassification = asString((item as any)?.classification);
  const safeOutcome = String((item as any)?.outcome || "unknown");
  const safeSlaState = String((item as any)?.sla_state || "").trim();


  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between">
        <div className="text-xs italic text-muted-foreground">
          Raised {formatDate(item.created_at)}
        </div>
        <div className="text-[10px] italic text-muted-foreground">
          Alert ID {item.id}
        </div>
      </div>

      <input
        ref={iocFileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = "";
          if (!file) return;
          void handleImport("iocs", file);
        }}
      />

      <input
        ref={assetFileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = "";
          if (!file) return;
          void handleImport("assets", file);
        }}
      />



      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex h-8 items-center">
              <LeftButton
                onClick={() => navigate("/alerts")}
                title="Back"
                iconOnly
                className="px-1 py-1 h-fit min-h-0 line-height-none"
              />
            </div>
            <div className="text-3xl font-semibold tracking-tight text-foreground">
              {item.title}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <SlaBadge state={safeSlaState} />
              
              <InlineEditableBadge
                value={String((item as any).customer || "")}
                disabled={!item || busyAlertId === item.id || !canUpdate}
                ariaLabel="Change customer"
                options={customers
                  .filter((c) => c.is_active)
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((c) => ({
                    value: String(c.id),
                    label: c.name,
                  }))}
                onChange={async (next) => {
                  const nextCustomerId = next || null;
                  setBusyAlertId(item.id);
                  try {
                    await updateAlert(alertId, { customer: nextCustomerId } as any);
                    push({ kind: "success", title: "Customer updated" });
                    await refreshAll();
                  } catch (err: any) {
                    push({
                      kind: "error",
                      title: "Error",
                      message: String(
                        err?.response?.data?.detail ??
                          err?.response?.status ??
                          "network"
                      ),
                    });
                  } finally {
                    setBusyAlertId(null);
                  }
                }}
                display={
                  <InlineTextBadge>
                    {(item as any).customer_name || "No customer"}
                  </InlineTextBadge>
                }
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Workflow className="size-4 text-muted-foreground" />
                <InlineEditableBadge
                  value={String(safeStatus || "")}
                  onChange={async (next) => {
                    await changeAlertStatus(next);
                  }}
                  disabled={busyAction || !canUpdate}
                  options={alertStatusOptions}
                  ariaLabel="Change status"
                  display={<StatusBadge status={safeStatus} />}
                />
              </div>

              <div className="flex items-center gap-2">
                <Activity className="size-4 text-muted-foreground" />
                <InlineEditableBadge
                  value={String(safeSeverity || "")}
                  onChange={async (next) => {
                    await changeAlertSeverity(next);
                  }}
                  disabled={busyAction || !canUpdate}
                  options={sevOptions
                    .slice()
                    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
                    .map((s) => ({ value: s.code, label: s.label }))}
                  ariaLabel="Change severity"
                  display={<SeverityBadge value={safeSeverity} />}
                />
              </div>

              <div className="flex items-center gap-2">
                <NotebookText className="size-4 text-muted-foreground" />
                <InlineEditableBadge
                  value={String(safeClassification || "")}
                  onChange={async (next) => {
                    await changeAlertClassification(next);
                  }}
                  disabled={busyAction || !canUpdate}
                  options={clsOptions
                    .slice()
                    .sort((a, b) => a.label.localeCompare(b.label))
                    .map((c) => ({ value: c.code, label: c.label }))}
                  ariaLabel="Change classification"
                  display={<ClassificationBadge value={safeClassification} />}
                />
              </div>
            </div>

            <div className="mt-4 text-xs italic text-muted-foreground">
              Alert source: {(item as any).source || "—"}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-start gap-3 xl:items-end">
          <div className="flex flex-wrap items-center gap-2">
            {canMerge ? (
              <MergeButton
                disabled={busyAction || !canMerge}
                onClick={() => setMergeUI({ alertId })}
                title="Merge alert"
              />
            ) : null}

            <OpenCloseToggleButton
              isOpen={safeStatus !== "closed"}
              disabled={busyAction || !canUpdate}
              onClick={async () => {
                const nextStatus = safeStatus === "closed" ? "open" : "closed";
                setBusyAction(true);
                try {
                  await updateAlert(alertId, { status: nextStatus } as any);
                  push({
                    kind: "success",
                    title:
                      nextStatus === "closed"
                        ? "Alert closed"
                        : "Alert re-opened",
                  });
                  await refreshAll();
                } catch (e: any) {
                  push({
                    kind: "error",
                    title: "Error",
                    message: String(
                      e?.response?.data?.detail ??
                        e?.response?.status ??
                        "network"
                    ),
                  });
                } finally {
                  setBusyAction(false);
                }
              }}
            />

            <DeleteButton
              disabled={busyAction || !canDelete}
              onClick={() => setConfirmDeleteAlert(true)}
              title="Delete alert"
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Info className="size-4 text-muted-foreground" />
              <InlineEditableBadge
                value={safeOutcome}
                onChange={async (next) => {
                  await changeAlertOutcome(next);
                }}
                disabled={busyAction || !canUpdate}
                options={outcomeOptions}
                ariaLabel="Change outcome"
                display={<OutcomeBadge value={safeOutcome} />}
                menuAlign="right"
              />
            </div>

            <div className="flex items-center gap-2">
              <UserRound className="size-4 text-muted-foreground" />
              <InlineEditableBadge
                value={String((item as any).owner_id ?? (item as any).owner ?? "")}
                disabled={busyAction || busyAlertId === item.id || !canUpdate}
                ariaLabel="Change owner"
                menuAlign="right"
                options={users.map((u) => ({
                  value: String(u.id),
                  label: u.username,
                }))}
                onChange={async (next) => {
                  const nextOwnerId = next ? Number(next) : null;
                  setBusyAlertId(item.id);
                  try {
                    await updateAlert(alertId, { owner: nextOwnerId } as any);
                    push({ kind: "success", title: "Owner updated" });
                    await refreshAll();
                  } catch (err: any) {
                    push({
                      kind: "error",
                      title: "Error",
                      message: String(err?.response?.status ?? "network"),
                    });
                  } finally {
                    setBusyAlertId(null);
                  }
                }}
                display={
                  <InlineTextBadge>
                    {(item as any).owner_username || "Unassigned"}
                  </InlineTextBadge>
                }
              />
            </div>
          </div>

          {linkedCaseId ? (
            <div className="mt-2 text-xs text-muted-foreground">
              Linked case:{" "}
              <Link
                to={`/cases/${linkedCaseId}`}
                className="font-medium text-foreground hover:underline"
              >
                {linkedCaseTitle || `Case ${linkedCaseId}`}
              </Link>
              {linkedCaseCustomerName ? (
                <span className="text-muted-foreground"> • {linkedCaseCustomerName}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>


      <Card className="p-5">
        <div
          onFocus={() => {
            alertDescFocusedRef.current = true;
            setDescriptionActionsVisible(true);
          }}
          onBlur={(e) => {
            const wrapper = e.currentTarget;

            window.requestAnimationFrame(() => {
              const activeElement = document.activeElement;

              if (activeElement && wrapper.contains(activeElement)) {
                return;
              }

              const openMdxDropdown = document.querySelector(
                "[role='listbox'], [role='menu'], [data-radix-popper-content-wrapper]"
              );

              if (openMdxDropdown) {
                return;
              }

              alertDescFocusedRef.current = false;
              setDescriptionActionsVisible(false);
            });
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-foreground">Description</div>
            {descriptionActionsVisible ? (
              <div className="flex items-center gap-2">
                <SaveButton
                  onClick={() => void saveDescriptionFromEditor()}
                  disabled={busyAction || !canUpdate || (editDescription ?? "") === (item.description ?? "")}
                  title="Save description"
                >
                  Save
                </SaveButton>
                <CancelButton
                  onClick={cancelDescriptionEdit}
                  disabled={busyAction || !canUpdate}
                  title="Cancel"
                />
              </div>
            ) : null}
          </div>

          <MarkdownEditor
            value={editDescription ?? ""}
            onChange={(v) => setEditDescription(v)}
            disabled={busyAction || !canUpdate}
            placeholder="Write a description..."
            className="text-sm"
          />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <KeyValueEditor
            title="IoCs"
            rows={(item as any).iocs || []}
            disabled={busyAction || loading || !canUpdate}
            showStatus={true}
            statusOptions={IOC_STATUS_OPTIONS}
            scrollBodyClassName="max-h-[420px]"
            headerActions={
              <>
                <TinyCsvButton
                  label="Import CSV"
                  title="Import IoCs from CSV"
                  disabled={busyAction || loading || !canUpdate}
                  onClick={() => iocFileInputRef.current?.click()}
                />
                <TinyCsvButton
                  label="Export CSV"
                  title="Export IoCs to CSV"
                  disabled={busyAction || loading}
                  onClick={() => {
                    void handleExport("iocs");
                  }}
                />
              </>
            }
            onChange={async (next) => {
              await updateAlert(alertId, { iocs: next } as any);
              await refreshAll();
            }}
          />
        </Card>

        <Card className="p-5">
          <KeyValueEditor
            title="Assets"
            rows={(item as any).assets || []}
            disabled={busyAction || loading || !canUpdate}
            showStatus={true}
            statusOptions={ASSET_STATUS_OPTIONS}
            scrollBodyClassName="max-h-[420px]"
            headerActions={
              <>
                <TinyCsvButton
                  label="Import CSV"
                  title="Import assets from CSV"
                  disabled={busyAction || loading || !canUpdate}
                  onClick={() => assetFileInputRef.current?.click()}
                />
                <TinyCsvButton
                  label="Export CSV"
                  title="Export assets to CSV"
                  disabled={busyAction || loading}
                  onClick={() => {
                    void handleExport("assets");
                  }}
                />
              </>
            }
            onChange={async (next) => {
              if (!canUpdate) return;
              await updateAlert(alertId, { assets: next } as any);
              await refreshAll();
            }}
          />
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-3 text-lg font-semibold text-foreground">
          Investigation
        </div>

        <MarkdownEditor
          value={commentText}
          onChange={(v) => setCommentText(v)}
          disabled={busyAction || !canUpdate}
          placeholder="Write a note..."
          className="text-sm text-foreground"
        />

        <NewGenButton
          onClick={submitComment}
          disabled={busyAction || !canUpdate || isRichTextEmpty(commentText)}
          className="mt-3 w-full"
          iconOnly={false}
          label="Add note"
          title="Add note"
        />

        <div className="mt-5 space-y-3">
          {comments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-8 text-center">
              <div className="text-sm font-medium text-foreground">
                No note yet
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Start documenting the investigation here.
              </div>
            </div>
          ) : (
            comments
              .slice()
              .reverse()
              .map((c) => (
                <div
                  key={c.id}
                  className="rounded-2xl border border-border bg-background p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      {formatDate(c.created_at)}
                      {c.author_display ? (
                        <span className="ml-1 text-muted-foreground/90">• {c.author_display}</span>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                      {editingCommentId === c.id ? (
                        <>
                          <SaveButton
                            onClick={() => saveEditComment(c.id)}
                            disabled={
                              busyAction ||
                              !canUpdate ||
                              commentBusyId === c.id ||
                              isRichTextEmpty(editingText)
                            }
                            title="Save comment"
                          >
                            {commentBusyId === c.id ? "Saving…" : "Save"}
                          </SaveButton>

                          <CancelButton
                            onClick={cancelEditComment}
                            disabled={busyAction || !canUpdate || commentBusyId === c.id}
                            title="Cancel"
                          />
                        </>
                      ) : (
                        <EditGenButton
                          onClick={() => startEditComment(c)}
                          disabled={busyAction || !canUpdate}
                          title="Edit comment"
                        />
                      )}

                      <DeleteButton
                        onClick={() => setConfirmCommentDelete(c.id)}
                        disabled={busyAction || !canUpdate || commentBusyId === c.id}
                        title="Delete comment"
                      />
                    </div>
                  </div>

                  {editingCommentId === c.id ? (
                    <div className="mt-3">
                      <MarkdownEditor
                        value={editingText}
                        onChange={(v) => setEditingText(v)}
                        disabled={busyAction || !canUpdate || commentBusyId === c.id}
                        placeholder="Edit note..."
                        className="text-sm text-foreground"
                      />
                    </div>
                  ) : (
                    <div className="mt-3 min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_*]:break-words [&_*]:[overflow-wrap:anywhere] [&_a]:break-all [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_code]:whitespace-pre-wrap [&_code]:break-words [&_code]:[overflow-wrap:anywhere]">
                      <MarkdownRenderedContent
                        markdown={String(c.text || "")}
                        className="min-w-0 max-w-full"
                      />
                    </div>
                  )}
                </div>
              ))
          )}
        </div>
      </Card>

      <AlertMergeDialog
        open={!!mergeUI}
        busy={busyAction}
        onCancel={() => setMergeUI(null)}
        onConfirmNew={async () => {
          if (!mergeUI || !canMerge) return;
          setBusyAction(true);
          try {
            const r = await escalateAlert(mergeUI.alertId);

            if (r.already_linked) {
              push({
                kind: "info",
                title: "Already linked",
                message: "This alert is already linked to a case.",
              });
              setMergeUI(null);
              await refreshAll();
              navigate(`/cases/${r.case_id}`);
              return;
            }

            push({
              kind: "success",
              title: r.created_case ? "Case created" : "Escalated",
            });
            setMergeUI(null);
            await refreshAll();
            navigate(`/cases/${r.case_id}`);
          } catch (e: any) {
            push({
              kind: "error",
              title: "Error",
              message: String(e?.response?.status ?? "network"),
            });
          } finally {
            setBusyAction(false);
          }
        }}
        onConfirmExisting={async (caseId) => {
          if (!mergeUI || !canMerge) return;
          setBusyAction(true);
          try {
            const r = await mergeAlertIntoCase(mergeUI.alertId, caseId);

            if (r.already_linked) {
              push({
                kind: "info",
                title: "Already linked",
                message: "This alert is already linked to this case.",
              });
              setMergeUI(null);
              await refreshAll();
              navigate(`/cases/${r.case_id}`);
              return;
            }

            if (r.conflict) {
              push({
                kind: "error",
                title: "Conflict",
                message: "This alert is already linked to another case.",
              });
              navigate(`/cases/${r.current_case_id}`);
              return;
            }

            if (r.linked) {
              push({ kind: "success", title: "Merged into case" });
              setMergeUI(null);
              await refreshAll();
              navigate(`/cases/${r.case_id}`);
              return;
            }

            push({ kind: "error", title: "Unexpected response" });
          } catch (e: any) {
            const status = e?.response?.status;
            const data = e?.response?.data;

            if (status === 409 && data?.conflict && data?.current_case_id) {
              push({
                kind: "error",
                title: "Conflict",
                message: "This alert is already linked to another case.",
              });
              navigate(`/cases/${data.current_case_id}`);
              return;
            }

            push({
              kind: "error",
              title: "Error",
              message: String(data?.error ?? status ?? "network"),
            });
          } finally {
            setBusyAction(false);
          }
        }}
      />

      <ConfirmDialog
        open={confirmDeleteAlert}
        title="Confirm"
        message="Delete this alert ?"
        confirmText="Delete"
        onCancel={() => {
          if (busyAction) return;
          setConfirmDeleteAlert(false);
        }}
        onConfirm={async () => {
          if (!alertId || busyAction || !canDelete) return;
          setBusyAction(true);
          try {
            await deleteAlert(alertId);
            push({ kind: "success", title: "Alert deleted" });
            navigate("/alerts");
          } catch (e: any) {
            push({
              kind: "error",
              title: "Error",
              message: String(e?.response?.status ?? "network"),
            });
          } finally {
            setBusyAction(false);
            setConfirmDeleteAlert(false);
          }
        }}
      />

      <ConfirmDialog
        open={!!confirmCommentDelete}
        title="Confirm"
        message="Delete this comment ?"
        confirmText="Delete"
        onCancel={() => {
          if (busyAction) return;
          setConfirmCommentDelete(null);
        }}
        onConfirm={async () => {
          if (!confirmCommentDelete || busyAction || !canUpdate) return;

          setBusyAction(true);
          const cid = confirmCommentDelete;
          setConfirmCommentDelete(null);

          try {
            await deleteAlertComment(cid);
            push({ kind: "info", title: "Comment deleted" });
            await refreshAll();
          } catch (e: any) {
            push({
              kind: "error",
              title: "Error",
              message: String(e?.response?.status ?? "network"),
            });
          } finally {
            setBusyAction(false);
          }
        }}
      />
    </div>
  );
}