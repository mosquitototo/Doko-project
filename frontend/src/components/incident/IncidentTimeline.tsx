import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Card from "../ui/Card";
import { useToast } from "../ui/toast";
import {
  type IncidentTimelineItem,
  listIncidentTimeline,
  createIncidentTimelineItem,
  patchIncidentTimelineItem,
  deleteIncidentTimelineItem,
} from "../../api/incidentTimeline";
import {
  EditGenButton,
  DeleteButton,
  SaveButton,
  NewGenButton,
  CancelButton,
} from "../../components/ui/IconButton";

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDayLabel(iso: string) {
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day} / ${month} / ${year}`;
  } catch {
    return iso;
  }
}

function dayKey(iso: string) {
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return iso;
  }
}

function kindLabel(k?: string | null) {
  return (k || "event").replace(/_/g, " ");
}

function toLocalInput(iso: string) {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate()
    )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function fromLocalInput(v: string, fallback?: string) {
  if (!v) return fallback || new Date().toISOString();

  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    return fallback || new Date().toISOString();
  }

  return d.toISOString();
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </label>
  );
}

const KIND_OPTIONS = [
  { value: "detection", label: "Detection" },
  { value: "triage", label: "Triage" },
  { value: "containment", label: "Containment" },
  { value: "eradication", label: "Eradication" },
  { value: "recovery", label: "Recovery" },
  { value: "remediation", label: "Remediation" },
  { value: "report", label: "Report" },
  { value: "communication", label: "Communication" },
  { value: "evidence", label: "Evidence" },
  { value: "other", label: "Other" },
];

const SEV_OPTIONS = [
  { value: "info", label: "Info" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
] as const;

function sevStyle(sev?: string | null) {
  switch (sev) {
    case "critical":
      return {
        dot: "bg-rose-600 dark:bg-rose-500",
        card: "border-rose-200/90 bg-rose-200/80 dark:border-rose-900/70 dark:bg-rose-950/30",
        badge: "border-rose-500 bg-rose-100 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/50 dark:text-rose-300",
      };
    case "high":
      return {
        dot: "bg-orange-500 dark:bg-orange-400",
        card: "border-orange-200/90 bg-orange-50/80 dark:border-orange-900/70 dark:bg-orange-950/25",
        badge: "border-orange-200 bg-orange-100 text-orange-700 dark:border-orange-900/70 dark:bg-orange-950/50 dark:text-orange-300",
      };
    case "medium":
      return {
        dot: "bg-amber-500 dark:bg-amber-400",
        card: "border-amber-200/90 bg-amber-50/80 dark:border-amber-900/70 dark:bg-amber-950/25",
        badge: "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/50 dark:text-amber-300",
      };
    case "low":
      return {
        dot: "bg-sky-500 dark:bg-sky-400",
        card: "border-sky-200/90 bg-sky-50/80 dark:border-sky-900/70 dark:bg-sky-950/25",
        badge: "border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/50 dark:text-sky-300",
      };
    default:
      return {
        dot: "bg-slate-500 dark:bg-slate-400",
        card: "border-slate-200/90 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/60",
        badge: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300",
      };
  }
}

type Draft = Pick<
  IncidentTimelineItem,
  "occurred_at" | "title" | "details" | "kind" | "severity" | "source"
>;

export default function IncidentTimeline({
  caseId,
  disabled,
}: {
  caseId: string;
  disabled?: boolean;
}) {
  const { push } = useToast();
  const [items, setItems] = useState<IncidentTimelineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalItemId, setModalItemId] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<"create" | "edit">("edit");

  async function refresh() {
    if (!caseId) return;
    setLoading(true);
    try {
      const r = await listIncidentTimeline(caseId);
      setItems(r);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [caseId]);

  const sorted = useMemo(() => {
    return items
      .slice()
      .sort(
        (a, b) =>
          new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
      );
  }, [items]);

  const activeItem = useMemo(() => {
    if (!modalItemId) return null;
    return items.find((x) => x.id === modalItemId) || null;
  }, [items, modalItemId]);

  function openEdit(id: string) {
    if (disabled) return;
    setModalMode("edit");
    setModalItemId(id);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setModalItemId(null);
    setModalMode("edit");
  }

  function onAdd() {
    if (disabled) return;
    setModalMode("create");
    setModalItemId(null);
    setModalOpen(true);
  }

  async function onCreate(draft: Draft) {
    if (disabled) return;

    setBusyId("new");
    try {
      await createIncidentTimelineItem(caseId, {
        occurred_at: draft.occurred_at,
        title: draft.title,
        details: draft.details,
        kind: draft.kind,
        severity: draft.severity,
        source: draft.source,
      });

      await refresh();
      push({ kind: "success", title: "Event created" });
      closeModal();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
    } finally {
      setBusyId(null);
    }
  }

  async function onSaveEdit(id: string, draft: Draft) {
    if (disabled || !id) return;

    setBusyId(id);
    try {
      const updated = await patchIncidentTimelineItem(id, draft as any);
      if (!updated?.id) {
        push({
          kind: "error",
          title: "Error",
          message: "Update returned an invalid object (missing id).",
        });
        await refresh();
        return;
      }
      await refresh();
      push({ kind: "success", title: "Saved" });
      closeModal();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(id: string) {
    if (disabled) return;
    setBusyId(id);
    try {
      await deleteIncidentTimelineItem(id);
      push({ kind: "success", title: "Event deleted" });
      setItems((prev) => prev.filter((x) => x.id !== id));
      if (modalItemId === id) closeModal();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="overflow-visible p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-foreground">
            Incident timeline
          </div>
          <div className="text-xs text-muted-foreground">
            {sorted.length} events
          </div>
        </div>

        <NewGenButton
          disabled={busyId === "new" || loading || !!disabled}
          onClick={onAdd}
          title="New event"
          iconOnly={false}
          label="New event"
        />
      </div>

      {loading ? (
        <div className="space-y-3 py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-16 w-full animate-pulse rounded-2xl bg-muted"
            />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-10 text-center">
          <div className="text-sm font-medium text-foreground">
            No incident events yet
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Add the first milestone of the investigation timeline.
          </div>
        </div>
      ) : (
        <VerticalList items={sorted} onEdit={openEdit} disabled={!!disabled} />
      )}

      <EditIncidentModal
        open={modalOpen}
        mode={modalMode}
        item={modalMode === "edit" ? activeItem : null}
        busy={busyId === "new" || busyId === activeItem?.id}
        disabled={!!disabled}
        onClose={closeModal}
        onSave={(draft) => {
          if (modalMode === "create") {
            void onCreate(draft);
            return;
          }
          if (!activeItem?.id) return;
          void onSaveEdit(activeItem.id, draft);
        }}
        onDelete={() => {
          if (modalMode !== "edit") return;
          if (!activeItem?.id) return;
          void onDelete(activeItem.id);
        }}
      />
    </Card>
  );
}

function VerticalList({
  items,
  onEdit,
  disabled,
}: {
  items: IncidentTimelineItem[];
  onEdit: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

      <div className="space-y-4">
        {items.map((it, idx) => {
          const s = sevStyle(it.severity);
          const currentDay = dayKey(it.occurred_at);
          const prevDay = idx > 0 ? dayKey(items[idx - 1].occurred_at) : null;
          const showDaySeparator = idx === 0 || currentDay !== prevDay;

          return (
            <div key={it.id}>
              {showDaySeparator ? (
                <div className="relative mb-3 pt-1 pl-0">
                  <div className="absolute left-4 right-0 top-1/2 h-px -translate-y-1/2 bg-border/70" />
                  <div className="relative flex items-center">
                    <div className="w-8 shrink-0" />
                    <span className="rounded-full border-border bg-card px-3 py-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground shadow-sm">
                      {formatDayLabel(it.occurred_at)}
                    </span>
                  </div>
                </div>
              ) : null}

              <div className="relative pl-12">
                <div
                  className={`absolute left-[10px] top-5 h-3 w-3 rounded-full ring-4 ring-background ${s.dot}`}
                />

                <div
                  className={`rounded-2xl border p-4 shadow-sm transition hover:-translate-y-[1px] hover:shadow-md ${s.card}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {fmt(it.occurred_at)}
                        </span>

                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.badge}`}
                        >
                          {kindLabel(it.kind)}
                        </span>

                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.badge}`}
                        >
                          {it.severity || "info"}
                        </span>

                        {it.source ? (
                          <span className="truncate text-[11px] text-muted-foreground">
                            {it.source}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 break-words text-sm font-semibold text-foreground">
                        {it.title}
                      </div>

                      {it.details ? (
                        <div className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                          {it.details}
                        </div>
                      ) : null}
                    </div>

                    <EditGenButton
                      onClick={() => onEdit(it.id)}
                      title="Edit event"
                      disabled={!!disabled}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EditIncidentModal(props: {
  open: boolean;
  mode: "create" | "edit";
  item: IncidentTimelineItem | null;
  busy: boolean;
  disabled: boolean;
  onClose: () => void;
  onSave: (draft: Draft) => void;
  onDelete: () => void;
}) {
  const { open, item, busy, disabled, onClose, onSave, onDelete } = props;

  const [draft, setDraft] = useState<Draft>({
    occurred_at: new Date().toISOString(),
    title: "",
    details: "",
    kind: "detection",
    severity: "info",
    source: "manual",
  });

  useEffect(() => {
    if (!open) return;

    if (props.mode === "create") {
      setDraft({
        occurred_at: new Date().toISOString(),
        title: "",
        details: "",
        kind: "detection",
        severity: "info",
        source: "manual",
      });
      return;
    }

    if (!item) return;

    setDraft({
      occurred_at: item.occurred_at,
      title: item.title || "",
      details: item.details || "",
      kind: item.kind || "detection",
      severity: item.severity || "info",
      source: item.source || "",
    });
  }, [open, props.mode, item?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canAct = !disabled && !busy;
  const canDelete = props.mode === "edit";

  const modal = (
    <div className="fixed inset-0 z-[120]">
      <button
        type="button"
        className="absolute inset-0 m-0 appearance-none rounded-none border-0 bg-black/40 p-0 outline-none backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close modal"
      />

      <div className="absolute right-0 top-0 flex h-full w-full max-w-[620px] flex-col border-l border-border bg-card shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-semibold text-foreground">
                {props.mode === "create"
                  ? "New incident event"
                  : "Edit incident event"}
              </div>
              <div className="mt-1 text-[11px] font-mono text-muted-foreground">
                {item?.id || ""}
              </div>
            </div>

            <CancelButton onClick={onClose} disabled={busy} title="Close" />
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-5">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel>Occurred at</FieldLabel>
                <input
                  className="h-10 w-full cursor-pointer rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                  type="datetime-local"
                  value={toLocalInput(draft.occurred_at)}
                  disabled={!canAct}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      occurred_at: fromLocalInput(e.target.value, draft.occurred_at),
                    }))
                  }
                />
              </div>

              <div>
                <FieldLabel>Category</FieldLabel>
                <select
                  className="h-10 w-full cursor-pointer rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                  value={draft.kind || "detection"}
                  disabled={!canAct}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, kind: e.target.value }))
                  }
                >
                  {KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel>Severity</FieldLabel>
                <select
                  className="h-10 w-full cursor-pointer rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                  value={draft.severity || "info"}
                  disabled={!canAct}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      severity: e.target.value as any,
                    }))
                  }
                >
                  {SEV_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <FieldLabel>Source</FieldLabel>
                <input
                  className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                  value={draft.source || ""}
                  disabled={!canAct}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, source: e.target.value }))
                  }
                  placeholder="manual / api / siem / …"
                />
              </div>
            </div>

            <div>
              <FieldLabel>Title</FieldLabel>
              <input
                className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                value={draft.title}
                disabled={!canAct}
                autoFocus
                onChange={(e) =>
                  setDraft((p) => ({ ...p, title: e.target.value }))
                }
              />
            </div>

            <div>
              <FieldLabel>Details</FieldLabel>
              <textarea
                className="min-h-[220px] w-full resize-y rounded-2xl border border-border bg-card px-3 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                rows={10}
                value={draft.details || ""}
                disabled={!canAct}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, details: e.target.value }))
                }
                placeholder="Add event details..."
              />
            </div>
          </div>
        </div>

        <div className="border-t border-border bg-background/50 px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            {props.mode === "edit" ? (
              <DeleteButton
                title="Delete event"
                disabled={!canAct}
                onClick={onDelete}
              />
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <SaveButton
                title="Save event"
                disabled={!canAct || !draft.title.trim()}
                onClick={() =>
                  onSave({
                    ...draft,
                    title: draft.title.trim(),
                    details: String(draft.details || "").trim(),
                    source: String(draft.source || "").trim(),
                  })
                }
              >
                {busy ? "Saving…" : "Save"}
              </SaveButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}