import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Card from "../components/ui/Card";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import MarkdownEditor from "../components/ui/MarkdownEditor";
import MarkdownRenderedContent from "../components/ui/MarkdownRenderedContent";
import type { MarkdownLinkAction } from "../components/ui/markdownLinks";
import UserAvatar from "../components/ui/UserAvatar";
import StatusBadge from "../components/ui/StatusBadge";
import MultiSelectCombobox, { type MultiSelectComboboxOption } from "../components/ui/MultiSelectCombobox";
import {
  NewGenButton,
  SaveButton,
  EditGenButton,
  CancelButton,
  DeleteButton,
  LeftButton,
  CalendarClock,
  UserRound,
  Workflow,
  Activity,
} from "../components/ui/IconButton";
import { useUiAccess } from "../hooks/useUiAccess";
import { fetchUsersLite, type UserLite } from "../api/usersLite";
import { listCustomers, type Customer } from "../api/settingsCustomers";
import { fetchTickets } from "../api/cases";
import type { TaskComment, TaskDetail as TaskDetailType, TaskLinkedCase, TaskPriority, TaskStatus } from "../api/tasks";
import {
  fetchTaskDetail,
  patchTask,
  deleteTask,
  listTaskComments,
  createTaskComment,
  patchTaskComment,
  deleteTaskComment,
  listTaskCaseLinks,
  createTaskCaseLink,
  deleteTaskCaseLink,
} from "../api/tasks";

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function isoToLocalDateTimeInputValue(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localDateTimeInputValueToIso(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function isRichTextEmpty(value?: string | null) {
  const text = String(value || "")
    .replace(/```[\s\S]*?```/g, " code ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " image ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/[#>*_~|[\]()`-]/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  return !text;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </label>
  );
}

function PriorityBadge({ value }: { value?: string | null }) {
  const v = String(value || "").trim();
  const cls =
    v === "critical"
      ? "border-red-200 bg-red-50 text-red-700"
      : v === "high"
      ? "border-orange-200 bg-orange-50 text-orange-700"
      : v === "medium"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-slate-200 bg-slate-50 text-slate-700";

  const label =
    v === "critical"
      ? "Critical"
      : v === "high"
      ? "High"
      : v === "medium"
      ? "Medium"
      : v === "low"
      ? "Low"
      : "—";

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function InlineEditableBadge(props: {
  value: string;
  onChange: (next: string) => void | Promise<void>;
  disabled?: boolean;
  options: { value: string; label: string }[];
  display: React.ReactNode;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
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
        disabled={props.disabled}
        aria-label={props.ariaLabel}
        title={props.ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        className={[
          "inline-flex border-none bg-transparent items-center rounded-xl transition",
          props.disabled
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer hover:scale-[1.05] focus:outline-none focus:ring-ring/20",
        ].join(" ")}
      >
        {props.display}
      </button>

      {open && !props.disabled ? (
        <div className="absolute left-0 top-full z-50 mt-2 min-w-[220px] overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
          <div className="max-h-72 overflow-auto p-1.5">
            {props.options.map((option) => {
              const selected = option.value === props.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={async () => {
                    setOpen(false);
                    if (option.value !== props.value) {
                      await props.onChange(option.value);
                    }
                  }}
                  className={[
                    "flex w-full border-none bg-transparent cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition",
                    selected
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-accent/60",
                  ].join(" ")}
                >
                  <span>{option.label}</span>
                  {selected ? <span className="text-xs text-muted-foreground">Selected</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InlineMultiEditableBadge(props: {
  values: string[];
  onChange: (next: string[]) => void | Promise<void>;
  disabled?: boolean;
  options: { value: string; label: string }[];
  display: React.ReactNode;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
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

  const selected = new Set(props.values.map(String));

  return (
    <div ref={rootRef} className="relative inline-flex items-center">
      <button
        type="button"
        disabled={props.disabled}
        aria-label={props.ariaLabel}
        title={props.ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        className={[
          "inline-flex border-none bg-transparent items-center rounded-xl transition",
          props.disabled
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer hover:scale-[1.05] focus:outline-none focus:ring-ring/20",
        ].join(" ")}
      >
        {props.display}
      </button>

      {open && !props.disabled ? (
        <div className="absolute left-0 top-full z-50 mt-2 min-w-[260px] overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
          <div className="max-h-72 overflow-auto p-1.5">
            {props.options.map((option) => {
              const isSelected = selected.has(String(option.value));

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={async () => {
                    const next = isSelected
                      ? props.values.filter((value) => String(value) !== String(option.value))
                      : [...props.values.map(String), String(option.value)];

                    await props.onChange(next);
                  }}
                  className={[
                    "flex w-full border-none bg-transparent cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition",
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-accent/60",
                  ].join(" ")}
                >
                  <span>{option.label}</span>
                  {isSelected ? <span className="text-xs text-muted-foreground">Selected</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InlineDateBadge(props: {
  value: string;
  onChange: (next: string) => void | Promise<void>;
  onClear: () => void | Promise<void>;
  disabled?: boolean;
  display: React.ReactNode;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
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
        disabled={props.disabled}
        aria-label={props.ariaLabel}
        title={props.ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        className={[
          "inline-flex border-none bg-transparent items-center rounded-xl transition",
          props.disabled
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer hover:scale-[1.05] focus:outline-none focus:ring-ring/20",
        ].join(" ")}
      >
        {props.display}
      </button>

      {open && !props.disabled ? (
        <div className="absolute right-0 top-full z-50 mt-2 min-w-[260px] rounded-2xl border border-border bg-card p-3 shadow-panel">
          <input
            type="datetime-local"
            className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
            value={props.value}
            onChange={async (e) => {
              await props.onChange(e.target.value);
            }}
          />

          <button
            type="button"
            onClick={async () => {
              await props.onClear();
            }}
            className="mt-2 w-full rounded-2xl border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-accent/60"
          >
            Clear due date
          </button>
        </div>
      ) : null}
    </div>
  );
}

function InlineTextBadge(props: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground shadow-sm">
      {props.children}
    </span>
  );
}

function InlineMutedBadge(props: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
      {props.children}
    </span>
  );
}


const TASK_STATUS_OPTIONS = [
  { value: "to_do", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "canceled", label: "Canceled" },
];

const TASK_PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];


export default function TaskDetail() {
    const { id } = useParams();
    const taskId = id || "";
    const navigate = useNavigate();
    const { me, push, can, deny, handleActionError } = useUiAccess();

    const [users, setUsers] = useState<UserLite[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [casesLite, setCasesLite] = useState<
    { id: string; title: string; status?: string; updated_at?: string; case_number?: number | null; customer_id?: string | null }[]
        >([]);

    const [task, setTask] = useState<TaskDetailType | null>(null);
    const [comments, setComments] = useState<TaskComment[]>([]);
    const [caseLinks, setCaseLinks] = useState<TaskLinkedCase[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const [editTitle, setEditTitle] = useState("");
    const [titleActionsVisible, setTitleActionsVisible] = useState(false);
    const [editDescription, setEditDescription] = useState("");
    const [descriptionActionsVisible, setDescriptionActionsVisible] = useState(false);
    const [descriptionExpanded, setDescriptionExpanded] = useState(false);
    const [descriptionOverflow, setDescriptionOverflow] = useState(false);
    const [noteEditorOpen, setNoteEditorOpen] = useState(false);
    const [linkAction, setLinkAction] = useState<{ target: string; request: MarkdownLinkAction } | null>(null);
    const descriptionContentRef = useRef<HTMLDivElement | null>(null);
    const [editStatus, setEditStatus] = useState<TaskStatus>("to_do");
    const [editPriority, setEditPriority] = useState<TaskPriority>("medium");
    const [editDueDate, setEditDueDate] = useState("");
    const [editOwnerId, setEditOwnerId] = useState("");
    const [editCustomerIds, setEditCustomerIds] = useState<string[]>([]);

    const [commentText, setCommentText] = useState("");
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState("");
    const [commentBusyId, setCommentBusyId] = useState<string | null>(null);
    const [commentSubmitting, setCommentSubmitting] = useState(false);

    const [confirmDeleteTask, setConfirmDeleteTask] = useState(false);
    const [confirmDeleteCommentId, setConfirmDeleteCommentId] = useState<string | null>(null);
    const [confirmUnlinkCase, setConfirmUnlinkCase] = useState<{ id: string; title: string } | null>(null);

    const [selectedCaseId, setSelectedCaseId] = useState("");

    const usersArr = useMemo(() => (Array.isArray(users) ? users : []), [users]);
    const customersArr = useMemo(() => (Array.isArray(customers) ? customers : []), [customers]);

    const customerDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
        () =>
        customersArr
            .slice()
            .sort((a, b) => (a?.name || "").localeCompare(b?.name || ""))
            .map((c) => ({ value: String(c.id), label: c.name })),
        [customersArr]
    );

    const ownerLabel =
      usersArr.find((u) => String(u.id) === String(editOwnerId))?.username ||
      (String(task?.owner_id_read ?? "") === editOwnerId ? task?.owner_username : null) || "Unassigned";

    const selectedCustomerNames = JSON.stringify(editCustomerIds) === JSON.stringify(task?.customer_ids ?? [])
      ? task?.customer_names ?? []
      : editCustomerIds.map((id) => customersArr.find((c) => String(c.id) === String(id))?.name).filter(Boolean) as string[];

    const customerBadgeLabel =
      selectedCustomerNames.length === 0
        ? "No customer"
        : selectedCustomerNames.length === 1
        ? selectedCustomerNames[0]
        : `${selectedCustomerNames.length} customers`;

    const dueDateBadgeLabel = editDueDate
      ? formatDate(localDateTimeInputValueToIso(editDueDate))
      : "No due date";

    const titleEditableRef = useRef<HTMLDivElement>(null);
    const descFocusedRef = useRef(false);
    const saveInFlightRef = useRef(false);
    const saveQueuedRef = useRef(false);

    const canViewTask = can("task.view") || can("task.manage");
    const canUpdateTask = can("task.manage") || (can("task.add") && task?.owner_id_read === me?.id);
    const canDeleteTask = can("task.manage");

    useEffect(() => {
      const element = descriptionContentRef.current;
      if (!element) return;
      const measure = () => setDescriptionOverflow(element.scrollHeight > 384);
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }, [task?.description, descriptionActionsVisible]);

    function startDescriptionEdit(request?: MarkdownLinkAction) {
      setEditDescription(task?.description ?? "");
      descFocusedRef.current = true;
      setDescriptionActionsVisible(true);
      setLinkAction(request ? { target: "description", request } : null);
    }

    async function refreshAll() {
        if (!taskId) return;
        setError(null);

        const t = await fetchTaskDetail(taskId);
        setTask(t);
        setEditTitle(t.title || "");
        if (!descFocusedRef.current) setEditDescription(t.description || "");
        setEditStatus((t.status as TaskStatus) || "to_do");
        setEditPriority((t.priority as TaskPriority) || "medium");
        setEditDueDate(isoToLocalDateTimeInputValue(t.due_date));
        setEditOwnerId(String((t as any).owner_id_read ?? ""));
        setEditCustomerIds(Array.isArray((t as any).customer_ids) ? (t as any).customer_ids.map(String) : []);

        const [c, links] = await Promise.all([
        listTaskComments(taskId),
        listTaskCaseLinks(taskId),
        ]);
        setComments(Array.isArray(c) ? c : []);
        setCaseLinks(Array.isArray(links) ? links : []);
    }

    async function saveIfDirty() {
        if (!canUpdateTask) {
            deny("update tasks");
            return;
        }
        if (!taskId || !task) return;
        if (saveInFlightRef.current) {
        saveQueuedRef.current = true;
        return;
        }

        const nextTitle = editTitle.trim();
        if (!nextTitle) {
        setEditTitle(task.title);
        return;
        }

        const nextDescription = editDescription ?? "";
        const nextOwnerId = editOwnerId ? Number(editOwnerId) : null;
        const nextDueDate = localDateTimeInputValueToIso(editDueDate);

        const noChange =
        nextTitle === (task.title ?? "") &&
        nextDescription === (task.description ?? "") &&
        editStatus === task.status &&
        editPriority === task.priority &&
        nextDueDate === (task.due_date ?? null) &&
        nextOwnerId === (task.owner_id_read ?? null) &&
            JSON.stringify([...editCustomerIds].map(String).sort()) ===
            JSON.stringify([...(((task as any).customer_ids ?? []) as string[])].map(String).sort());

        if (noChange) return true;

        saveInFlightRef.current = true;
        setBusy(true);
        try {
        const updated = await patchTask(taskId, {
            title: nextTitle,
            description: nextDescription,
            status: editStatus,
            priority: editPriority,
            due_date: nextDueDate,
            owner_id: nextOwnerId,
            customer_ids: editCustomerIds,
        });
        setTask((prev) => ({ ...(prev as any), ...(updated as any) }));
        window.dispatchEvent(new CustomEvent("doko:tasks-changed"));
        await refreshAll();
        return true;
        } catch (e: any) {
        handleActionError(e, "update tasks", "Unable to update task.");
        } finally {
        saveInFlightRef.current = false;
        setBusy(false);
        if (saveQueuedRef.current) {
            saveQueuedRef.current = false;
            void saveIfDirty();
        }
        }
    }

    async function patchTaskInline(
      payload: Partial<{
        status: TaskStatus;
        priority: TaskPriority;
        due_date: string | null;
        owner_id: number | null;
        customer_ids: string[];
      }>
    ) {
      if (!canUpdateTask) {
        deny("update tasks");
        return;
      }

      if (!taskId || !task || busy) return;

      setBusy(true);

      try {
        const updated = await patchTask(taskId, payload);
        setTask((prev) => ({ ...(prev as any), ...(updated as any) }));
        window.dispatchEvent(new CustomEvent("doko:tasks-changed"));
        await refreshAll();
      } catch (e: any) {
        handleActionError(e, "update tasks", "Unable to update task.");
        await refreshAll().catch(() => undefined);
      } finally {
        setBusy(false);
      }
    }

    async function saveTitleEdit() {
      await saveIfDirty();
      setTitleActionsVisible(false);
    }

    function cancelTitleEdit() {
      const currentTitle = String(task?.title || "");
      setEditTitle(currentTitle);

      if (titleEditableRef.current) {
        titleEditableRef.current.textContent = currentTitle;
      }

      setTitleActionsVisible(false);
    }

    async function saveDescriptionFromEditor() {
        if (await saveIfDirty()) {
            descFocusedRef.current = false;
            setDescriptionActionsVisible(false);
        }
    }

    function cancelDescriptionEdit() {
        setEditDescription(task?.description || "");
        descFocusedRef.current = false;
        setDescriptionActionsVisible(false);
    }

    async function submitComment() {
    if (!canUpdateTask) {
        deny("add task comments");
        return;
    }
    if (!taskId || isRichTextEmpty(commentText) || commentSubmitting) return;

    setCommentSubmitting(true);
    try {
        const created = await createTaskComment(taskId, { text: commentText });
        setCommentText("");
        setNoteEditorOpen(false);

        if (created && created.id) {
        setComments((prev) => [...prev, created]);
        }

        await refreshAll();
    } catch (e: any) {
    handleActionError(e, "add task comments", "Unable to add comment.");
    } finally {
        setCommentSubmitting(false);
    }
    }

    function startEditComment(c: TaskComment) {
        setLinkAction(null);
        setEditingCommentId(c.id);
        setEditingText(String(c.text || ""));
    }

    function cancelEditComment() {
        setEditingCommentId(null);
        setEditingText("");
    }

    async function saveEditComment(commentId: string) {
      if (!canUpdateTask) {
        deny("edit task comments");
        return;
      }

      const next = editingText;

      if (!taskId || isRichTextEmpty(next)) return;

      setCommentBusyId(commentId);

      try {
        await patchTaskComment(commentId, { text: next });

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

        cancelEditComment();
      } catch (e: any) {
        handleActionError(e, "edit task comments", "Unable to update comment.");
      } finally {
        setCommentBusyId(null);
      }
    }

    async function onDeleteComment() {
        if (!canUpdateTask) {
            deny("delete task comments");
            return;
        }
        if (!confirmDeleteCommentId) return;
        const target = confirmDeleteCommentId;
        setConfirmDeleteCommentId(null);
        setCommentBusyId(target);
        try {
        await deleteTaskComment(target);
        await refreshAll();
        } catch (e: any) {
        handleActionError(e, "delete task comments", "Unable to delete comment.");
        } finally {
        setCommentBusyId(null);
        }
    }

    async function onLinkCase() {
        if (!canUpdateTask) {
            deny("link cases to tasks");
            return;
        }
        if (!taskId || !selectedCaseId) return;
        setBusy(true);
        try {
        await createTaskCaseLink(taskId, { case_id: selectedCaseId });
            setTask((prev) =>
            prev
                ? {
                    ...prev,
                    linked_case_count: Number(prev.linked_case_count || 0) + 1,
                }
                : prev
            );
        setSelectedCaseId("");
        await refreshAll();
        } catch (e: any) {
        handleActionError(e, "link cases to tasks", "Unable to link case.");
        } finally {
        setBusy(false);
        }
    }

    async function onUnlinkCase(linkId: string) {
        if (!canUpdateTask) {
            deny("unlink cases from tasks");
            return;
        }
        setBusy(true);
        try {
        await deleteTaskCaseLink(linkId);
            setTask((prev) =>
            prev
                ? {
                    ...prev,
                    linked_case_count: Math.max(0, Number(prev.linked_case_count || 0) - 1),
                }
                : prev
            );
        await refreshAll();
        } catch (e: any) {
        handleActionError(e, "unlink cases from tasks", "Unable to unlink case.");
        } finally {
        setBusy(false);
        }
    }

    useEffect(() => {
        if (!canUpdateTask) {
            setUsers([]);
            setCustomers([]);
            setCasesLite([]);
            return;
        }

        fetchUsersLite().then(setUsers).catch(() => setUsers([]));
        listCustomers({ include_inactive: false })
            .then((r: any) => setCustomers(r.results ?? []))
            .catch(() => setCustomers([]));
    }, [canUpdateTask]);

    useEffect(() => {
        if (!canUpdateTask || !task) {
            setCasesLite([]);
            return;
        }

        const taskCustomerIds = Array.isArray(task.customer_ids)
            ? task.customer_ids.map(String).filter(Boolean)
            : [];

        fetchTickets({
            page: 1,
            page_size: 10000,
            include_archived: undefined,
            ...(taskCustomerIds.length === 1 ? { customer: taskCustomerIds[0] } : {}),
        } as any)
            .then((r: any) => {
                const items = Array.isArray(r?.results) ? r.results : [];
                setCasesLite(
                    items
                        .map((x: any) => ({
                            id: String(x.id),
                            title: String(x.title || ""),
                            status: x.status,
                            updated_at: x.updated_at,
                            case_number: x.case_number ?? null,
                            customer_id: x.customer_id ? String(x.customer_id) : null,
                        }))
                        .filter((x: any) => {
                            if (!taskCustomerIds.length) return true;
                            if (!x.customer_id) return true;
                            return taskCustomerIds.includes(String(x.customer_id));
                        })
                );
            })
            .catch(() => setCasesLite([]));
    }, [canUpdateTask, task?.id, JSON.stringify(task?.customer_ids || [])]);

    useEffect(() => {
    let mounted = true;

    if (!canViewTask) {
        navigate("/tasks");
        return () => {
        mounted = false;
        };
    }

    (async () => {
        try {
        await refreshAll();
        } catch (e: any) {
        if (!mounted) return;

        const status = Number(e?.response?.status || 0);

        if (status === 403) {
            navigate("/tasks");
            return;
        }

        if (status === 404) {
            push({
            kind: "info",
            title: "Task not found",
            message: "It may have been deleted.",
            });
            navigate("/tasks");
            return;
        }

        setError("Unable to load task.");
        }
    })();

    return () => {
        mounted = false;
    };
    }, [taskId, canViewTask, navigate, push]);

    useEffect(() => {
      if (!titleEditableRef.current) return;
      if (titleEditableRef.current.textContent !== editTitle) {
        titleEditableRef.current.textContent = editTitle;
      }
    }, [editTitle]);

    if (error) {
        return <div className="text-sm text-muted-foreground">{error}</div>;
    }
    if (!task) return <div>Loading •••</div>;

return (
  <div className="space-y-6">
      <nav aria-label="Task navigation" className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border pb-2 text-xs text-muted-foreground">
        <div className="flex min-w-0 basis-full items-center gap-2 sm:flex-1 sm:basis-0 sm:pr-8">
          <LeftButton onClick={() => navigate("/tasks")} title="Back" iconOnly className="h-8 w-8 shrink-0 border-transparent bg-transparent p-1 shadow-none" />
          <Link to="/tasks" className="hover:underline">Tasks</Link>
          <span aria-hidden="true">›</span>
          <span className="min-w-0 max-w-lg truncate" title={task.title}>{task.title}</span>
        </div>
        <div className="ml-auto max-w-full text-right leading-4">
          <div className="break-all text-[10px] leading-4">Task UUID: {task.id}</div>
          <div className="text-[10px] italic leading-4">Last update {formatDate(task.updated_at)}</div>
        </div>
      </nav>

      <div className="!mt-3 flex min-w-0 flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <div
              ref={titleEditableRef}
              contentEditable={canUpdateTask && !busy}
              role="textbox"
              tabIndex={0}
              suppressContentEditableWarning
              className="break-words text-2xl font-semibold tracking-tight text-foreground outline-none px-1 py-0.5 rounded-md hover:bg-accent/40 focus:bg-accent/40 cursor-text [overflow-wrap:anywhere]"
              onInput={(e) => {
                setTitleActionsVisible(true);
                setEditTitle(e.currentTarget.textContent || "");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveTitleEdit();
                }
              }}
            />

            {titleActionsVisible && editTitle.trim() !== String(task.title || "") ? (
              <div className="mt-2 flex items-center gap-2">
                <SaveButton
                  onClick={() => void saveTitleEdit()}
                  disabled={busy || !canUpdateTask || !editTitle.trim()}
                  title="Save title"
                >
                  Save
                </SaveButton>
                <CancelButton
                  onClick={cancelTitleEdit}
                  disabled={busy || !canUpdateTask}
                  title="Cancel"
                />
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Workflow className="size-4 text-muted-foreground" />
                <InlineEditableBadge
                  value={String(editStatus || "")}
                  onChange={async (next) => {
                    setEditStatus(next as TaskStatus);
                    await patchTaskInline({ status: next as TaskStatus });
                  }}
                  disabled={busy || !canUpdateTask}
                  options={TASK_STATUS_OPTIONS}
                  ariaLabel="Change status"
                  display={<StatusBadge status={editStatus} />}
                />
              </div>

              <div className="flex items-center gap-2">
                <Activity className="size-4 text-muted-foreground" />
                <InlineEditableBadge
                  value={String(editPriority || "")}
                  onChange={async (next) => {
                    setEditPriority(next as TaskPriority);
                    await patchTaskInline({ priority: next as TaskPriority });
                  }}
                  disabled={busy || !canUpdateTask}
                  options={TASK_PRIORITY_OPTIONS}
                  ariaLabel="Change priority"
                  display={<PriorityBadge value={editPriority} />}
                />
              </div>

              <div className="flex items-center gap-2">
                <UserRound className="size-4 text-muted-foreground" />
                <InlineEditableBadge
                  value={String(editOwnerId || "")}
                  onChange={async (next) => {
                    setEditOwnerId(next);
                    await patchTaskInline(
                      { owner_id: next ? Number(next) : null }
                    );
                  }}
                  disabled={busy || !canUpdateTask}
                  options={[
                    { value: "", label: "Unassigned" },
                    ...usersArr.map((u) => ({ value: String(u.id), label: u.username })),
                  ]}
                  ariaLabel="Change owner"
                  display={<InlineTextBadge>{ownerLabel}</InlineTextBadge>}
                />
              </div>

              <div className="flex items-center gap-2">
                <CalendarClock className="size-4 text-muted-foreground" />
                <InlineDateBadge
                  value={editDueDate}
                  onChange={async (next) => {
                    setEditDueDate(next);
                    await patchTaskInline(
                      { due_date: localDateTimeInputValueToIso(next) }
                    );
                  }}
                  onClear={async () => {
                    setEditDueDate("");
                    await patchTaskInline({ due_date: null });
                  }}
                  disabled={busy || !canUpdateTask}
                  ariaLabel="Change due date"
                  display={<InlineMutedBadge>{dueDateBadgeLabel}</InlineMutedBadge>}
                />
              </div>

              <div className="flex items-center gap-2">
                <InlineMultiEditableBadge
                  values={editCustomerIds}
                  onChange={async (next) => {
                    const normalized = next.map(String);
                    setEditCustomerIds(normalized);
                    await patchTaskInline({ customer_ids: normalized });
                  }}
                  disabled={busy || !canUpdateTask}
                  options={customersArr
                    .slice()
                    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                    .map((c) => ({ value: String(c.id), label: c.name }))}
                  ariaLabel="Change customers"
                  display={<InlineTextBadge>{customerBadgeLabel}</InlineTextBadge>}
                />
              </div>

            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-3">
            <div className="flex flex-wrap justify-end gap-2">
              {canDeleteTask ? (
                <DeleteButton
                  onClick={() => setConfirmDeleteTask(true)}
                  disabled={busy || !canUpdateTask}
                  iconOnly={true}
                  label="Delete"
                  title="Delete"
                />
              ) : null}
            </div>
          </div>
        </div>
      <div className="space-y-6">
        <div className="min-w-0">
      <Card className="min-w-0 p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-lg font-semibold text-foreground">Description</div>
            {descriptionActionsVisible ? (
              <div className="flex items-center gap-2">
                <SaveButton
                  onClick={() => void saveDescriptionFromEditor()}
                  disabled={busy || !canUpdateTask || (editDescription ?? "") === (task.description ?? "")}
                  title="Save description"
                >
                  Save
                </SaveButton>
                <CancelButton
                  onClick={cancelDescriptionEdit}
                  disabled={busy || !canUpdateTask}
                  title="Cancel"
                />
              </div>
            ) : canUpdateTask ? <EditGenButton onClick={() => startDescriptionEdit()} disabled={busy} title="Edit description" /> : null}
          </div>

          {descriptionActionsVisible ? <MarkdownEditor
            alwaysShowToolbar
            value={editDescription ?? ""}
            initialLinkAction={linkAction?.target === "description" ? linkAction.request : undefined}
            onChange={(v) => setEditDescription(v)}
            disabled={busy || !canUpdateTask}
            placeholder="Write a description..."
            className="text-sm"
          /> : <>
            <div className={descriptionExpanded ? "min-w-0" : "max-h-96 min-w-0 overflow-hidden"}>
              <div ref={descriptionContentRef} className="min-w-0 break-words [overflow-wrap:anywhere]">
                {task.description ? <MarkdownRenderedContent markdown={task.description} requireLinkModifier onEditLink={canUpdateTask && !busy ? startDescriptionEdit : undefined} /> : <span className="text-sm text-muted-foreground">No description</span>}
              </div>
            </div>
            {descriptionOverflow ? <button type="button" aria-expanded={descriptionExpanded} className="mx-auto mt-2 block min-w-32 rounded-xl border border-border bg-muted/50 px-6 py-1 text-xs font-medium text-foreground transition hover:bg-accent" onClick={() => setDescriptionExpanded(value => !value)}>{descriptionExpanded ? "Show less" : "Show more"}</button> : null}
          </>}
      </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.36fr)] xl:items-start">
          <div className="min-w-0">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-lg font-semibold text-foreground">Comments <span className="rounded-full border border-border bg-background px-2 text-xs font-normal text-muted-foreground">{comments.length}</span></div>
              </div>
              {!noteEditorOpen && canUpdateTask ? <NewGenButton onClick={() => setNoteEditorOpen(true)} disabled={busy} iconOnly={false} label="Add note" title="Add note" /> : null}
            </div>

            {noteEditorOpen ? <div className="space-y-3">
            <MarkdownEditor
              alwaysShowToolbar
              value={commentText}
              onChange={(v) => setCommentText(v)}
              disabled={busy || !canUpdateTask || commentSubmitting}
              placeholder="Write a note..."
              className="text-sm text-foreground"
            />

            <div className="flex justify-end gap-2">
            <CancelButton onClick={() => { setNoteEditorOpen(false); setCommentText(""); }} disabled={busy || commentSubmitting} title="Cancel note" />
            <NewGenButton
              onClick={() => void submitComment()}
              disabled={busy || !canUpdateTask || commentSubmitting || isRichTextEmpty(commentText)}
              iconOnly={false}
              label="Publish"
              title="Publish note"
            />
            </div>
            </div> : null}

            <div className="mt-5 space-y-3">
              {comments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-3 text-center">
                  <div className="text-sm font-medium text-foreground">No note yet</div>
                  <div className="mt-1 text-xs text-muted-foreground">Add the first comment for this task.</div>
                </div>
              ) : (
                comments
                  .slice()
                  .reverse()
                  .map((c, index) => (
                    <div key={c.id} className="relative grid min-w-0 grid-cols-[12px_28px_minmax(0,1fr)] gap-2 sm:gap-3">
                      <div aria-hidden="true" className="relative flex justify-center">
                        {index < comments.length - 1 ? <span className="absolute -bottom-3 top-6 border-l border-border" /> : null}
                        <span className="relative mt-5 h-3 w-3 rounded-full border border-muted-foreground bg-card" />
                      </div>
                      <div className="mt-3"><UserAvatar showInitial name={c.author_display} src={c.author_avatar_url} /></div>
                      <div className="min-w-0 rounded-2xl border border-border bg-background p-3 shadow-sm">
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="break-words text-sm font-semibold text-foreground">{c.author_display || "Unknown author"}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(c.created_at)}</span>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          {editingCommentId === c.id ? (
                            <>
                              <SaveButton
                                onClick={() => saveEditComment(c.id)}
                                disabled={busy || !canUpdateTask || commentBusyId === c.id || isRichTextEmpty(editingText)}
                                title="Save comment"
                              >
                                {commentBusyId === c.id ? "Saving…" : "Save"}
                              </SaveButton>
                              <CancelButton
                                onClick={cancelEditComment}
                                disabled={busy || !canUpdateTask || commentBusyId === c.id}
                                title="Cancel"
                              />
                            </>
                          ) : (
                            <EditGenButton onClick={() => startEditComment(c)} disabled={busy || !canUpdateTask} title="Edit comment" />
                          )}

                          <DeleteButton
                            onClick={() => setConfirmDeleteCommentId(c.id)}
                            disabled={busy || !canUpdateTask || commentBusyId === c.id}
                            title="Delete comment"
                          />
                        </div>
                      </div>

                      {editingCommentId === c.id ? (
                        <div className="mt-3">
                          <MarkdownEditor
                            alwaysShowToolbar
                            value={editingText}
                            initialLinkAction={linkAction?.target === c.id ? linkAction.request : undefined}
                            onChange={(v) => setEditingText(v)}
                            disabled={busy || !canUpdateTask || commentBusyId === c.id}
                            placeholder="Edit note..."
                            className="text-sm"
                          />
                        </div>
                      ) : (
                        <div className="mt-3 min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_*]:break-words [&_*]:[overflow-wrap:anywhere] [&_a]:break-all [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_code]:whitespace-pre-wrap [&_code]:break-words [&_code]:[overflow-wrap:anywhere]">
                          <MarkdownRenderedContent
                            requireLinkModifier
                            markdown={String(c.text || "")}
                            onEditLink={canUpdateTask && !busy && commentBusyId !== c.id ? request => {
                              startEditComment(c);
                              setLinkAction({ target: c.id, request });
                            } : undefined}
                            className="min-w-0 max-w-full !rounded-none !border-0 !bg-transparent !shadow-none [&_[contenteditable=false]]:!p-0"
                          />
                        </div>
                      )}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </Card>
          </div>

          <div className="relative z-20">
            <Card className="relative z-10 p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-foreground">Linked cases</div>
                  <div className="text-xs text-muted-foreground">Cases attached to this task</div>
                </div>
                <div className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {caseLinks.length}
                </div>
              </div>

              <div className="mb-4 flex items-center gap-2">
                <select
                  className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                  value={selectedCaseId}
                  onChange={(e) => setSelectedCaseId(e.target.value)}
                  disabled={busy || !canUpdateTask}
                >
                  <option value="">Select a case</option>
                  {casesLite.map((c) => (
                      <option key={c.id} value={c.id}>
                      {c.case_number ? `#${c.case_number} — ` : ""}{c.title}
                      </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => void onLinkCase()}
                  disabled={busy || !canUpdateTask || !selectedCaseId}
                  className="rounded-2xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
                >
                  Link
                </button>
              </div>

              {caseLinks.length === 0 ? (
                <div className="text-sm text-muted-foreground">No linked case.</div>
              ) : (
                <div className="space-y-2">
                  {caseLinks.map((link) => (
                    <div key={link.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-background/60 p-3">
                      <div className="min-w-0">
                        <Link
                          to={`/cases/${link.case.id}`}
                          className="block truncate text-sm font-medium text-foreground hover:underline"
                          title={link.case.title}
                        >
                          {link.case.case_number ? `#${link.case.case_number} — ` : ""}
                          {link.case.title}
                        </Link>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {link.case.status ? `${link.case.status}` : ""}
                          {link.case.customer_name ? ` • ${link.case.customer_name}` : ""}
                        </div>
                      </div>

                      <DeleteButton
                        onClick={() => setConfirmUnlinkCase({ id: link.id, title: link.case.title })}
                        disabled={busy || !canUpdateTask}
                        title="Unlink case"
                      />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteTask}
        title="Confirm"
        message="Delete this task ?"
        confirmText="Delete"
        onCancel={() => {
          if (!busy) setConfirmDeleteTask(false);
        }}
        onConfirm={async () => {
            if (!taskId || busy) return;
            if (!canDeleteTask) {
            deny("delete tasks");
            return;
            }
            setBusy(true);
            try {
                await deleteTask(taskId);
                window.dispatchEvent(new CustomEvent("doko:tasks-changed"));
                push({ kind: "success", title: "Task deleted" });
                navigate("/tasks");
                } catch (e: any) {
                handleActionError(e, "delete tasks", "Unable to delete task.");
                } finally {
                setBusy(false);
                setConfirmDeleteTask(false);
            }
        }}
      />

      <ConfirmDialog
        open={!!confirmDeleteCommentId}
        title="Confirm"
        message="Delete this comment ?"
        confirmText="Delete"
        onCancel={() => {
          if (!commentBusyId) setConfirmDeleteCommentId(null);
        }}
        onConfirm={async () => {
          await onDeleteComment();
        }}
      />

      <ConfirmDialog
        open={!!confirmUnlinkCase}
        title="Confirm"
        message={confirmUnlinkCase ? `Unlink case "${confirmUnlinkCase.title}" ?` : ""}
        confirmText="Unlink"
        onCancel={() => {
          if (!busy) setConfirmUnlinkCase(null);
        }}
        onConfirm={async () => {
          if (!confirmUnlinkCase) return;
          const target = confirmUnlinkCase;
          setConfirmUnlinkCase(null);
          await onUnlinkCase(target.id);
        }}
      />
    </div>
  );
}
