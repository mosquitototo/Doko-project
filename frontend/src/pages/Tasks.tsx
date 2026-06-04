import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Card from "../components/ui/Card";
import StatusBadge from "../components/ui/StatusBadge";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import ConfirmDialogWide from "../components/ui/ConfirmDialogWide";
import { useUiAccess } from "../hooks/useUiAccess";
import { fetchUsersLite, type UserLite } from "../api/usersLite";
import { listCustomers, type Customer } from "../api/settingsCustomers";
import MultiSelectCombobox, { type MultiSelectComboboxOption } from "../components/ui/MultiSelectCombobox";
import SelectField from "../components/ui/SelectField";
import MarkdownEditor from "../components/ui/MarkdownEditor";
import {
  NewGenButton,
  LeftButton,
  RightButton,
  DeleteButton,
  ClearButton,
  Search, 
  SlidersHorizontal, 
  ChevronUp, 
  ChevronDown, 
  AlertTriangle, 
  Clock3,
} from "../components/ui/IconButton";
import {
  listTasks,
  createTask,
  patchTask,
  deleteTask,
  type TaskListItem,
  type TaskPriority,
  type TaskStatus,
} from "../api/tasks";

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function htmlToPlainText(value?: string | null) {
  return String(value || "")
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
}

function normalizeUsersLite(payload: any): UserLite[] {
  const raw = payload;
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : [];
  return arr
    .filter((u: any) => u && (u.id !== undefined && u.id !== null))
    .map((u: any) => ({
      id: u.id,
      username: String(u.username ?? u.name ?? `user-${u.id}`),
    }));
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </label>
  );
}

const pageSizeOptions = [10, 20, 50, 100];

const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: "to_do", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "canceled", label: "Canceled" },
];

const priorityOptions: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

type SortKey =
  | "title"
  | "status"
  | "priority"
  | "due_date"
  | "created_at"
  | "updated_at"
  | "linked_case_count"
  | "customer"
  | "owner";

type SortDirection = "asc" | "desc";

function parseOrdering(ordering: string): {
  key: SortKey;
  direction: SortDirection;
} {
  const direction: SortDirection = ordering.startsWith("-") ? "desc" : "asc";
  const raw = ordering.replace(/^-/, "");
  const key: SortKey =
    raw === "title" ||
    raw === "status" ||
    raw === "priority" ||
    raw === "due_date" ||
    raw === "created_at" ||
    raw === "updated_at" ||
    raw === "linked_case_count" ||
    raw === "customer" ||
    raw === "owner"
      ? raw
      : "updated_at";
  return { key, direction };
}

function compareNullableStrings(a: any, b: any) {
  return String(a || "").localeCompare(String(b || ""), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function HeaderSortLabel({
  label,
  active,
  direction,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
  align?: "left" | "center" | "right";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-1 cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition hover:text-foreground",
        align === "center"
          ? "justify-center"
          : align === "right"
          ? "justify-end"
          : "justify-start",
      ].join(" ")}
      title={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
        {active ? (
          direction === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )
        ) : null}
      </span>
    </button>
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

function DueDatePill({ dueDate, dueState }: { dueDate?: string | null; dueState?: string | null }) {
  if (!dueDate) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  if (dueState === "overdue") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
        <AlertTriangle className="h-3.5 w-3.5" />
        <span>{formatDate(dueDate)}</span>
      </div>
    );
  }

  if (dueState === "soon") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
        <Clock3 className="h-3.5 w-3.5" />
        <span>{formatDate(dueDate)}</span>
      </div>
    );
  }

  return <span className="text-xs text-muted-foreground">{formatDate(dueDate)}</span>;
}

export default function Tasks() {
    const [mineItems, setMineItems] = useState<TaskListItem[]>([]);
    const [allItems, setAllItems] = useState<TaskListItem[]>([]);
    const [mineServerCount, setMineServerCount] = useState(0);
    const [allServerCount, setAllServerCount] = useState(0);

    const mineItemsArr = useMemo(() => (Array.isArray(mineItems) ? mineItems : []), [mineItems]);
    const allItemsArr = useMemo(() => (Array.isArray(allItems) ? allItems : []), [allItems]);

    const [status, setStatus] = useState<string[]>([]);
    const [priority, setPriority] = useState<string[]>([]);
    const [owner, setOwner] = useState<string[]>([]);
    const [customer, setCustomer] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [ordering, setOrdering] = useState("-updated_at");
    const [filtersOpen, setFiltersOpen] = useState(false);

    const navigate = useNavigate();
    const { me, push, can, deny, handlePassiveLoadError, handleActionError } = useUiAccess();

    const canViewTask = can("task.view") || can("task.manage");
    const canAddTask = can("task.add");
    const canManageTask = can("task.manage");

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [searchInput, setSearchInput] = useState("");
    useEffect(() => {
        const t = setTimeout(() => {
        setPage(1);
        setSearch(searchInput.trim());
        }, 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    const [pageSize, setPageSize] = useState(20);
    const [selected, setSelected] = useState<Record<string, boolean>>({});

    const [users, setUsers] = useState<UserLite[]>([]);
    const usersArr = useMemo(() => (Array.isArray(users) ? users : []), [users]);

    const [customers, setCustomers] = useState<Customer[]>([]);
    const customersArr = useMemo(() => (Array.isArray(customers) ? customers : []), [customers]);

    const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);
    const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
    const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
    const [busyBulkAction, setBusyBulkAction] = useState(false);

    const [createOpen, setCreateOpen] = useState(false);
    const [createBusy, setCreateBusy] = useState(false);
    const [draftTitle, setDraftTitle] = useState("");
    const [draftDescription, setDraftDescription] = useState("");
    const [draftDueDate, setDraftDueDate] = useState("");
    const [draftPriority, setDraftPriority] = useState<TaskPriority>("medium");
    const [draftOwnerId, setDraftOwnerId] = useState("");
    const [draftCustomerIds, setDraftCustomerIds] = useState<string[]>([]);




    function isForbiddenError(e: any) {
    return Number(e?.response?.status) === 403;
    }


    function resetTasksSilently() {
        setMineItems([]);
        setAllItems([]);
        setMineServerCount(0);
        setAllServerCount(0);
        setError(null);
        setLoading(false);
        setSelected({});
    }

    useEffect(() => {
        let mounted = true;

        if (!canViewTask) {
            resetTasksSilently();
            return () => {
                mounted = false;
            };
        }

        setLoading(true);
        setError(null);

        const commonParams = {
            page: 1,
            page_size: 1000,
            search: search || undefined,
        };

        Promise.all([
            listTasks({
                ...commonParams,
                scope: "mine",
            }),
            canManageTask
                ? listTasks({
                    ...commonParams,
                    scope: "all",
                })
                : Promise.resolve({ results: [], count: 0 }),
        ])
            .then(([mineData, allData]) => {
                if (!mounted) return;

                setMineItems(Array.isArray(mineData?.results) ? mineData.results : []);
                setMineServerCount(Number(mineData?.count ?? 0));

                if (canManageTask) {
                    setAllItems(Array.isArray(allData?.results) ? allData.results : []);
                    setAllServerCount(Number(allData?.count ?? 0));
                } else {
                    setAllItems([]);
                    setAllServerCount(0);
                }
            })
            .catch((e: any) => {
                if (!mounted) return;

                handlePassiveLoadError(e, {
                    onForbidden: () => {
                        setMineItems([]);
                        setAllItems([]);
                        setMineServerCount(0);
                        setAllServerCount(0);
                        setSelected({});
                    },
                    setError,
                    fallback: "Unable to load tasks.",
                });
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });

        return () => {
            mounted = false;
        };
    }, [search, canViewTask, canManageTask, handlePassiveLoadError]);

    useEffect(() => {
        let mounted = true;
        fetchUsersLite()
        .then((payload: any) => {
            if (!mounted) return;
            setUsers(normalizeUsersLite(payload));
        })
        .catch(() => {
            if (!mounted) return;
            setUsers([]);
        });
        return () => {
        mounted = false;
        };
    }, []);

    useEffect(() => {
        let mounted = true;
        listCustomers({ include_inactive: false })
        .then((r: any) => {
            if (!mounted) return;
            setCustomers(Array.isArray(r?.results) ? r.results : []);
        })
        .catch(() => {
            if (!mounted) return;
            setCustomers([]);
        });
        return () => {
        mounted = false;
        };
    }, []);

    const statusDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
        () => statusOptions.map((o) => ({ value: o.value, label: o.label })),
        []
    );

    const priorityDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
        () => priorityOptions.map((o) => ({ value: o.value, label: o.label })),
        []
    );

    const ownerDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
        () => usersArr.map((u) => ({ value: String(u.id), label: u.username })),
        [usersArr]
    );

    const customerDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
        () =>
        customersArr
            .slice()
            .sort((a, b) => (a?.name || "").localeCompare(b?.name || ""))
            .map((c) => ({ value: String(c.id), label: c.name })),
        [customersArr]
    );

    function filterTaskItems(source: TaskListItem[]) {
        return source.filter((t: TaskListItem) => {
        const itemStatus = String(t?.status || "");
        const itemPriority = String(t?.priority || "");
        const itemOwner = String(t?.owner_id ?? t?.owner_id_read ?? "");
        const itemCustomers = Array.isArray(t?.customer_ids) ? t.customer_ids.map(String) : [];

        const statusOk = status.length === 0 || status.includes(itemStatus);
        const priorityOk = priority.length === 0 || priority.includes(itemPriority);
        const ownerOk = owner.length === 0 || owner.includes(itemOwner);
        const customerOk = customer.length === 0 || itemCustomers.some((id) => customer.includes(id));

        return statusOk && priorityOk && ownerOk && customerOk;
        });
    }

    const filteredMineItems = useMemo(
        () => filterTaskItems(mineItemsArr),
        [mineItemsArr, status, priority, owner, customer]
    );

    const filteredAllItems = useMemo(
        () => filterTaskItems(allItemsArr),
        [allItemsArr, status, priority, owner, customer]
    );

    const sortMeta = useMemo(() => parseOrdering(ordering), [ordering]);

    function sortTaskItems(source: TaskListItem[]) {
        const arr = [...source];

        arr.sort((a, b) => {
        let result = 0;

        switch (sortMeta.key) {
            case "title":
            result = compareNullableStrings(a?.title, b?.title);
            break;
            case "status":
            result = compareNullableStrings(a?.status, b?.status);
            break;
            case "priority":
            result = compareNullableStrings(a?.priority, b?.priority);
            break;
            case "due_date":
            result = new Date(a?.due_date || 0).getTime() - new Date(b?.due_date || 0).getTime();
            break;
            case "created_at":
            result = new Date(a?.created_at || 0).getTime() - new Date(b?.created_at || 0).getTime();
            break;
            case "updated_at":
            result = new Date(a?.updated_at || 0).getTime() - new Date(b?.updated_at || 0).getTime();
            break;
            case "linked_case_count":
            result = Number(a?.linked_case_count || 0) - Number(b?.linked_case_count || 0);
            break;
            case "customer":
            result = compareNullableStrings(a?.customer_names?.join(", "), b?.customer_names?.join(", "));
            break;
            case "owner":
            result = compareNullableStrings(a?.owner_username, b?.owner_username);
            break;
            default:
            result = 0;
        }

        if (result === 0) {
            result = new Date(a?.updated_at || 0).getTime() - new Date(b?.updated_at || 0).getTime();
        }

        return sortMeta.direction === "asc" ? result : -result;
        });

        return arr;
    }

    const sortedAllItems = useMemo(
        () => sortTaskItems(filteredAllItems),
        [filteredAllItems, sortMeta]
    );

    const sortedMineItems = useMemo(() => {
        const currentUserId = String(me?.id ?? "");
        const sorted = sortTaskItems(filteredMineItems);

        if (!currentUserId) {
            return sorted;
        }

        return sorted.filter((t) => String(t?.owner_id ?? t?.owner_id_read ?? "") === currentUserId);
    }, [filteredMineItems, sortMeta, me?.id]);

    const sortedOtherItems = useMemo(() => {
        const currentUserId = String(me?.id ?? "");

        if (!currentUserId) {
            return [];
        }

        return sortedAllItems.filter((t) => String(t?.owner_id ?? t?.owner_id_read ?? "") !== currentUserId);
    }, [sortedAllItems, me?.id]);

    const mineCount = sortedMineItems.length;
    const allCount = sortedAllItems.length;
    const otherCount = sortedOtherItems.length;
    const totalPages = Math.max(1, Math.ceil(mineCount / pageSize));
    const allTotalPages = Math.max(1, Math.ceil(otherCount / pageSize));
    const [allPage, setAllPage] = useState(1);

    useEffect(() => {
        if (page > totalPages) {
        setPage(totalPages);
        }
    }, [page, totalPages]);

    useEffect(() => {
        if (allPage > allTotalPages) {
            setAllPage(allTotalPages);
        }
    }, [allPage, allTotalPages]);

    const pagedMineItems = useMemo(() => {
        const start = (page - 1) * pageSize;
        return sortedMineItems.slice(start, start + pageSize);
    }, [sortedMineItems, page, pageSize]);

    const pagedAllItems = useMemo(() => {
        const start = (allPage - 1) * pageSize;
        return sortedOtherItems.slice(start, start + pageSize);
    }, [sortedOtherItems, allPage, pageSize]);

    const pagedItems = pagedMineItems;

    const selectedIds = useMemo(
        () => Object.keys(selected || {}).filter((id) => !!selected?.[id]),
        [selected]
    );

    const allOnPageSelected = pagedItems.length > 0 && pagedItems.every((x) => !!selected?.[x.id]);
    const someOnPageSelected = pagedItems.some((x) => !!selected?.[x.id]);
    const isIndeterminate = someOnPageSelected && !allOnPageSelected;
    const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (headerCheckboxRef.current) {
        headerCheckboxRef.current.indeterminate = isIndeterminate;
        }
    }, [isIndeterminate]);

    const toggleAllOnPage = (checked: boolean) => {
        setSelected((prev) => {
        const safePrev = prev || {};
        const next = { ...safePrev };
        pagedItems.forEach((x) => {
            next[x.id] = checked;
        });
        return next;
        });
    };

    async function bulkDeleteTasks() {
        if (!canManageTask) {
        deny("delete tasks");
        return;
        }
        if (selectedIds.length === 0) return;

        setBusyBulkAction(true);
        try {
        await Promise.all(selectedIds.map((id) => deleteTask(id)));
        window.dispatchEvent(new CustomEvent("doko:tasks-changed"));
        push({ kind: "success", title: "Tasks deleted" });
        setMineItems((prev) => prev.filter((x) => !selected?.[x.id]));
        setAllItems((prev) => prev.filter((x) => !selected?.[x.id]));
        setSelected({});
        } catch (e: any) {
        handleActionError(e, "delete tasks", "Unable to delete tasks.");
        } finally {
        setBusyBulkAction(false);
        }
    }

    async function bulkSetStatus(nextStatus: TaskStatus) {
        if (!canManageTask) {
        deny("update tasks");
        return;
        }
        if (selectedIds.length === 0) return;

        setBusyBulkAction(true);
        try {
        await Promise.all(selectedIds.map((id) => patchTask(id, { status: nextStatus })));

        window.dispatchEvent(new CustomEvent("doko:tasks-changed"));
        push({
            kind: "success",
            title: "Tasks updated",
        });

        setMineItems((prev) =>
            prev.map((x) => (selected?.[x.id] ? { ...x, status: nextStatus } : x))
        );
        setAllItems((prev) =>
            prev.map((x) => (selected?.[x.id] ? { ...x, status: nextStatus } : x))
        );
        setSelected({});
        } catch (e: any) {
        handleActionError(e, "update tasks", "Unable to update tasks.");
        } finally {
        setBusyBulkAction(false);
        }
    }

    useEffect(() => {
        setSelected({});
    }, [page, pageSize, search, ordering, status, priority, owner, customer]);

    function toggleSort(key: SortKey) {
        setPage(1);
        setOrdering((prev) => {
        const current = parseOrdering(prev);
        if (current.key === key) {
            return current.direction === "asc" ? `-${key}` : key;
        }
        if (key === "updated_at") return "-updated_at";
        return key;
        });
    }

    const clearFilters = () => {
        setPage(1);
        setStatus([]);
        setPriority([]);
        setOwner([]);
        setCustomer([]);
        setSearchInput("");
        setSearch("");
    };

    function resetCreateDraft() {
        setDraftTitle("");
        setDraftDescription("");
        setDraftDueDate("");
        setDraftPriority("medium");
        setDraftOwnerId("");
        setDraftCustomerIds([]);
    }

    async function onCreateTask() {
        if (!canAddTask) {
            deny("create tasks");
        return;
        }
        const title = draftTitle.trim();
        if (!title) {
        push({ kind: "error", title: "Title is required" });
        return;
        }

        setCreateBusy(true);
        try {
        const created = await createTask({
            title,
            description: draftDescription,
            due_date: draftDueDate ? new Date(draftDueDate).toISOString() : null,
            priority: draftPriority,
            owner_id: draftOwnerId ? Number(draftOwnerId) : null,
            customer_ids: draftCustomerIds,
        });

        push({ kind: "success", title: "Task created" });
        window.dispatchEvent(new CustomEvent("doko:tasks-changed"));
        resetCreateDraft();
        setCreateOpen(false);

        if (created?.id) {
            navigate(`/tasks/${created.id}`);
            return;
        }

        const [mineData, allData] = await Promise.all([
            listTasks({ page: 1, page_size: 10000, search: search || undefined, scope: "mine" }),
            canManageTask
                ? listTasks({ page: 1, page_size: 10000, search: search || undefined, scope: "all" })
                : Promise.resolve({ results: [], count: 0 }),
        ]);

        setMineItems(Array.isArray(mineData?.results) ? mineData.results : []);
        setMineServerCount(Number(mineData?.count ?? 0));

        if (canManageTask) {
            setAllItems(Array.isArray(allData?.results) ? allData.results : []);
            setAllServerCount(Number(allData?.count ?? 0));
        }
        } catch (e: any) {
        handleActionError(e, "create tasks", "Unable to create task.");
        } finally {
        setCreateBusy(false);
        }
    }

    return (
        <div className="space-y-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
            <div className="text-3xl font-semibold tracking-tight text-foreground">Tasks</div>
                <div className="mt-1 text-sm text-muted-foreground">
                    {mineCount} assigned to me
                    {canManageTask ? ` • ${allCount} total` : ""}
                    {mineServerCount > 1000 || allServerCount > 1000 ? ` • first 1000 loaded` : ""}
                </div>
            </div>

            <NewGenButton
            onClick={() => {
                if (!canAddTask) {
                deny("create tasks");
                return;
                }
                setCreateOpen(true);
            }}
            iconOnly={false}
            label="New task"
            title="New task"
            />
        </div>

        <Card className="relative z-20 overflow-visible p-5">
            <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground">
                <SlidersHorizontal className="h-4 w-4" />
                </div>
                <div>
                <div className="text-sm font-semibold text-foreground">Filters</div>
                <div className="text-xs text-muted-foreground">Narrow the visible task scope</div>
                </div>
            </div>

            <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                className="rounded-2xl border cursor-pointer border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent"
            >
                {filtersOpen ? "Collapse" : "Expand"}
            </button>
            </div>

            {filtersOpen ? (
            <div className="mt-4 grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                <div className="space-y-4">
                <div className="max-w-xl">
                    <FieldLabel>Search</FieldLabel>

                    <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                        className="h-10 w-full rounded-2xl border border-border bg-card pl-10 pr-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                        placeholder="Task title or description…"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                    />
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                    <ClearButton
                    type="button"
                    variant="clear"
                    className="text-xs"
                    iconOnly={false}
                    label="Clear filters"
                    title="Clear filters"
                    onClick={clearFilters}
                    />
                </div>
                </div>

                <div className="relative z-30 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="min-w-0 text-xs">
                    <MultiSelectCombobox
                    label="Status"
                    options={statusDropdownOptions}
                    value={status}
                    onChange={(v) => {
                        setPage(1);
                        setStatus(v);
                    }}
                    placeholder="-"
                    widthClass="w-full"
                    />
                </div>

                <div className="min-w-0 text-xs">
                    <MultiSelectCombobox
                    label="Priority"
                    options={priorityDropdownOptions}
                    value={priority}
                    onChange={(v) => {
                        setPage(1);
                        setPriority(v);
                    }}
                    placeholder="-"
                    widthClass="w-full"
                    />
                </div>

                <div className="min-w-0 text-xs">
                    <MultiSelectCombobox
                    label="Owner"
                    options={ownerDropdownOptions}
                    value={owner}
                    onChange={(v) => {
                        setPage(1);
                        setOwner(v);
                    }}
                    placeholder="-"
                    widthClass="w-full"
                    />
                </div>

                <div className="min-w-0 text-xs">
                    <MultiSelectCombobox
                    label="Customer"
                    options={customerDropdownOptions}
                    value={customer}
                    onChange={(v) => {
                        setPage(1);
                        setCustomer(v);
                    }}
                    placeholder="-"
                    widthClass="w-full"
                    />
                </div>
                </div>
            </div>
            ) : null}
        </Card>

        <Card className="relative z-0 overflow-hidden p-0">
        <h1 className="p-4 text-sm">My assigned tasks</h1>
            {error ? (
            <div className="border-b border-destructive/20 bg-destructive/10 px-5 py-4 text-sm text-destructive">
                {error}
            </div>
            ) : null}

            {selectedIds.length > 0 ? (
            <div className="border-b border-border bg-background/70 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-foreground">{selectedIds.length} selected</div>

                <div className="flex flex-wrap gap-2">
                    <button
                    disabled={busyBulkAction || !canManageTask}
                    onClick={() => void bulkSetStatus("done")}
                    type="button"
                    className="rounded-2xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
                    >
                    Mark done
                    </button>

                    <button
                    disabled={busyBulkAction || !canManageTask}
                    onClick={() => void bulkSetStatus("to_do")}
                    type="button"
                    className="rounded-2xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
                    >
                    Re-open
                    </button>

                    {canManageTask ? (
                    <DeleteButton
                        disabled={busyBulkAction || !canManageTask}
                        onClick={() => setConfirmBulkDelete(true)}
                        type="button"
                        className="text-xs px-2"
                        iconOnly={false}
                        label="Delete"
                        title="Delete"
                    />
                    ) : null}
                </div>
                </div>
            </div>
            ) : null}

            {loading ? (
            <div className="space-y-3 p-5">
                {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 w-full animate-pulse rounded-2xl bg-muted" />
                ))}
            </div>
            ) : pagedItems.length === 0 ? (
            <div className="px-5 py-14 text-center">
                <div className="text-lg font-semibold text-foreground">No task found</div>
                <div className="mt-1 text-sm text-muted-foreground">
                Try adjusting filters or creating a new task.
                </div>
            </div>
            ) : (
            <>
                <div className="overflow-x-auto">
                <div className="min-w-[1440px]">
                    <div className="grid grid-cols-[30px_minmax(0,3fr)_110px_104px_170px_132px_132px_100px_minmax(0,1fr)_minmax(0,0.9fr)] gap-2 border-b border-border bg-background/70 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    <div className="flex items-center justify-center">
                        <input
                        ref={headerCheckboxRef}
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={(e) => toggleAllOnPage(e.target.checked)}
                        disabled={busyBulkAction || pagedItems.length === 0}
                        className="h-4 w-4"
                        />
                    </div>

                    <HeaderSortLabel
                        label="Title"
                        active={sortMeta.key === "title"}
                        direction={sortMeta.direction}
                        onClick={() => toggleSort("title")}
                    />

                    <HeaderSortLabel
                        label="Status"
                        active={sortMeta.key === "status"}
                        direction={sortMeta.direction}
                        onClick={() => toggleSort("status")}
                    />

                    <HeaderSortLabel
                        label="Priority"
                        active={sortMeta.key === "priority"}
                        direction={sortMeta.direction}
                        onClick={() => toggleSort("priority")}
                    />

                    <HeaderSortLabel
                        label="Due date"
                        active={sortMeta.key === "due_date"}
                        direction={sortMeta.direction}
                        onClick={() => toggleSort("due_date")}
                    />

                    <HeaderSortLabel
                        label="Created"
                        active={sortMeta.key === "created_at"}
                        direction={sortMeta.direction}
                        onClick={() => toggleSort("created_at")}
                    />

                    <HeaderSortLabel
                        label="Updated"
                        active={sortMeta.key === "updated_at"}
                        direction={sortMeta.direction}
                        onClick={() => toggleSort("updated_at")}
                    />

                    <HeaderSortLabel
                        label="Cases"
                        active={sortMeta.key === "linked_case_count"}
                        direction={sortMeta.direction}
                        onClick={() => toggleSort("linked_case_count")}
                        align="center"
                    />

                    <HeaderSortLabel
                        label="Customers"
                        active={sortMeta.key === "customer"}
                        direction={sortMeta.direction}
                        onClick={() => toggleSort("customer")}
                    />

                    <HeaderSortLabel
                        label="Owner"
                        active={sortMeta.key === "owner"}
                        direction={sortMeta.direction}
                        onClick={() => toggleSort("owner")}
                    />
                    </div>

                    <div className="divide-y divide-border">
                    {pagedItems.map((t) => (
                        <div key={t.id} className="px-4 py-4 transition hover:bg-accent/40">
                        <div className="grid grid-cols-[30px_minmax(0,3fr)_110px_104px_170px_132px_132px_100px_minmax(0,1fr)_minmax(0,0.9fr)] items-center gap-2">
                            <div className="flex items-center justify-center">
                            <input
                                type="checkbox"
                                checked={!!selected?.[t.id]}
                                onChange={(e) =>
                                setSelected((prev) => ({
                                    ...(prev || {}),
                                    [t.id]: e.target.checked,
                                }))
                                }
                                disabled={busyBulkAction}
                                className="h-4 w-4"
                            />
                            </div>

                            <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                                <Link
                                to={`/tasks/${t.id}`}
                                className="block min-w-0 truncate text-sm font-semibold text-foreground"
                                title={t.title}
                                >
                                {t.title}
                                </Link>
                            </div>

                            </div>

                            <div className="flex">
                            <StatusBadge status={t.status} />
                            </div>

                            <div className="flex">
                            <PriorityBadge value={t.priority} />
                            </div>

                            <div className="min-w-0">
                            <DueDatePill dueDate={t.due_date} dueState={t.due_state} />
                            </div>

                            <div className="text-xs text-muted-foreground">
                            {formatDate(t.created_at)}
                            </div>

                            <div className="text-xs text-muted-foreground">
                            {formatDate(t.updated_at)}
                            </div>

                            <div className="text-center text-sm font-medium text-foreground">
                            {Number(t.linked_case_count || 0)}
                            </div>

                            <div className="min-w-0 text-xs text-muted-foreground">
                            <div className="truncate" title={t.customer_names?.join(", ") || ""}>
                                {t.customer_names?.length ? t.customer_names.join(", ") : "—"}
                            </div>
                            </div>

                            <div className="min-w-0 text-xs text-muted-foreground">
                            <div className="truncate" title={t.owner_username || ""}>
                                {t.owner_username || "—"}
                            </div>
                            </div>
                        </div>
                        </div>
                    ))}
                    </div>
                </div>
                </div>

                <div className="flex flex-col gap-4 border-t border-border px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="text-xs text-muted-foreground">
                    Page {page} / {totalPages}
                </div>

                <div className="flex items-center gap-2">
                    <LeftButton
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    title="Previous"
                    />
                    <RightButton
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    title="Next"
                    />
                </div>

                <SelectField
                    label="Page size"
                    value={pageSize}
                    onChange={(value) => {
                    setSelected({});
                    setPage(1);
                    setPageSize(Number(value));
                    }}
                    options={pageSizeOptions.map((n) => ({
                    value: n,
                    label: String(n),
                    }))}
                    widthClass="w-[120px]"
                />
                </div>
            </>
            )}
        </Card>


        {canManageTask ? (
            <Card className="relative z-0 overflow-hidden p-0">
            <h1 className="p-4 text-sm">Other assigned tasks</h1>
                {error ? (
                <div className="border-b border-destructive/20 bg-destructive/10 px-5 py-4 text-sm text-destructive">
                    {error}
                </div>
                ) : null}

                {selectedIds.length > 0 ? (
                <div className="border-b border-border bg-background/70 px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-foreground">{selectedIds.length} selected</div>

                    <div className="flex flex-wrap gap-2">
                        <button
                        disabled={busyBulkAction || !canManageTask}
                        onClick={() => void bulkSetStatus("done")}
                        type="button"
                        className="rounded-2xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
                        >
                        Mark done
                        </button>

                        <button
                        disabled={busyBulkAction || !canManageTask}
                        onClick={() => void bulkSetStatus("to_do")}
                        type="button"
                        className="rounded-2xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
                        >
                        Re-open
                        </button>

                        {canManageTask ? (
                        <DeleteButton
                            disabled={busyBulkAction || !canManageTask}
                            onClick={() => setConfirmBulkDelete(true)}
                            type="button"
                            className="text-xs px-2"
                            iconOnly={false}
                            label="Delete"
                            title="Delete"
                        />
                        ) : null}
                    </div>
                    </div>
                </div>
                ) : null}

                {loading ? (
                <div className="space-y-3 p-5">
                    {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-16 w-full animate-pulse rounded-2xl bg-muted" />
                    ))}
                </div>
                ) : pagedAllItems.length === 0 ? (
                <div className="px-5 py-14 text-center">
                    <div className="text-lg font-semibold text-foreground">No other task found</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                    All visible tasks are currently assigned to you, or filters hide the others.
                    </div>
                </div>
                ) : (
                <>
                    <div className="overflow-x-auto">
                    <div className="min-w-[1440px]">
                        <div className="grid grid-cols-[30px_minmax(0,3fr)_110px_104px_170px_132px_132px_100px_minmax(0,1fr)_minmax(0,0.9fr)] gap-2 border-b border-border bg-background/70 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        <div className="flex items-center justify-center">
                            <input
                            ref={headerCheckboxRef}
                            type="checkbox"
                            checked={allOnPageSelected}
                            onChange={(e) => toggleAllOnPage(e.target.checked)}
                            disabled={busyBulkAction || pagedAllItems.length === 0}
                            className="h-4 w-4"
                            />
                        </div>

                        <HeaderSortLabel
                            label="Title"
                            active={sortMeta.key === "title"}
                            direction={sortMeta.direction}
                            onClick={() => toggleSort("title")}
                        />

                        <HeaderSortLabel
                            label="Status"
                            active={sortMeta.key === "status"}
                            direction={sortMeta.direction}
                            onClick={() => toggleSort("status")}
                        />

                        <HeaderSortLabel
                            label="Priority"
                            active={sortMeta.key === "priority"}
                            direction={sortMeta.direction}
                            onClick={() => toggleSort("priority")}
                        />

                        <HeaderSortLabel
                            label="Due date"
                            active={sortMeta.key === "due_date"}
                            direction={sortMeta.direction}
                            onClick={() => toggleSort("due_date")}
                        />

                        <HeaderSortLabel
                            label="Created"
                            active={sortMeta.key === "created_at"}
                            direction={sortMeta.direction}
                            onClick={() => toggleSort("created_at")}
                        />

                        <HeaderSortLabel
                            label="Updated"
                            active={sortMeta.key === "updated_at"}
                            direction={sortMeta.direction}
                            onClick={() => toggleSort("updated_at")}
                        />

                        <HeaderSortLabel
                            label="Cases"
                            active={sortMeta.key === "linked_case_count"}
                            direction={sortMeta.direction}
                            onClick={() => toggleSort("linked_case_count")}
                            align="center"
                        />

                        <HeaderSortLabel
                            label="Customers"
                            active={sortMeta.key === "customer"}
                            direction={sortMeta.direction}
                            onClick={() => toggleSort("customer")}
                        />

                        <HeaderSortLabel
                            label="Owner"
                            active={sortMeta.key === "owner"}
                            direction={sortMeta.direction}
                            onClick={() => toggleSort("owner")}
                        />
                        </div>

                        <div className="divide-y divide-border">
                        {pagedAllItems.map((t) => (
                            <div key={t.id} className="px-4 py-4 transition hover:bg-accent/40">
                            <div className="grid grid-cols-[30px_minmax(0,3fr)_110px_104px_170px_132px_132px_100px_minmax(0,1fr)_minmax(0,0.9fr)] items-center gap-2">
                                <div className="flex items-center justify-center">
                                <input
                                    type="checkbox"
                                    checked={!!selected?.[t.id]}
                                    onChange={(e) =>
                                    setSelected((prev) => ({
                                        ...(prev || {}),
                                        [t.id]: e.target.checked,
                                    }))
                                    }
                                    disabled={busyBulkAction}
                                    className="h-4 w-4"
                                />
                                </div>

                                <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-2">
                                    <Link
                                    to={`/tasks/${t.id}`}
                                    className="block min-w-0 truncate text-sm font-semibold text-foreground"
                                    title={t.title}
                                    >
                                    {t.title}
                                    </Link>
                                </div>

                                </div>

                                <div className="flex">
                                <StatusBadge status={t.status} />
                                </div>

                                <div className="flex">
                                <PriorityBadge value={t.priority} />
                                </div>

                                <div className="min-w-0">
                                <DueDatePill dueDate={t.due_date} dueState={t.due_state} />
                                </div>

                                <div className="text-xs text-muted-foreground">
                                {formatDate(t.created_at)}
                                </div>

                                <div className="text-xs text-muted-foreground">
                                {formatDate(t.updated_at)}
                                </div>

                                <div className="text-center text-sm font-medium text-foreground">
                                {Number(t.linked_case_count || 0)}
                                </div>

                                <div className="min-w-0 text-xs text-muted-foreground">
                                <div className="truncate" title={t.customer_names?.join(", ") || ""}>
                                    {t.customer_names?.length ? t.customer_names.join(", ") : "—"}
                                </div>
                                </div>

                                <div className="min-w-0 text-xs text-muted-foreground">
                                <div className="truncate" title={t.owner_username || ""}>
                                    {t.owner_username || "—"}
                                </div>
                                </div>
                            </div>
                            </div>
                        ))}
                        </div>
                    </div>
                    </div>

                    <div className="flex flex-col gap-4 border-t border-border px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
                    <div className="text-xs text-muted-foreground">
                        Page {allPage} / {allTotalPages}
                    </div>

                    <div className="flex items-center gap-2">
                        <LeftButton
                        disabled={allPage <= 1}
                        onClick={() => setAllPage((p) => Math.max(1, p - 1))}
                        title="Previous"
                        />
                        <RightButton
                        disabled={allPage >= allTotalPages}
                        onClick={() => setAllPage((p) => Math.min(allTotalPages, p + 1))}
                        title="Next"
                        />
                    </div>

                    <SelectField
                        label="Page size"
                        value={pageSize}
                        onChange={(value) => {
                        setSelected({});
                        setAllPage(1);
                        setPageSize(Number(value));
                        }}
                        options={pageSizeOptions.map((n) => ({
                        value: n,
                        label: String(n),
                        }))}
                        widthClass="w-[120px]"
                    />
                    </div>
                </>
                )}
            </Card>
        ) : null}



        <ConfirmDialog
            open={!!confirmDelete}
            title="Confirm"
            message={confirmDelete ? `Delete task "${confirmDelete.title}" ?` : ""}
            confirmText="Delete"
            onCancel={() => {
            if (busyDeleteId) return;
            setConfirmDelete(null);
            }}
            onConfirm={async () => {
                if (!canManageTask) {
                deny("delete tasks");
                return;
                }
            if (!confirmDelete) return;
            const target = confirmDelete;
            setConfirmDelete(null);

            setBusyDeleteId(target.id);
            try {
                await deleteTask(target.id);
                window.dispatchEvent(new CustomEvent("doko:tasks-changed"));
                push({ kind: "success", title: "Task deleted" });
                setMineItems((prev) => prev.filter((x) => x.id !== target.id));
                setAllItems((prev) => prev.filter((x) => x.id !== target.id));
            } catch (e: any) {
            handleActionError(e, "delete tasks", "Unable to delete task.");
            } finally {
                setBusyDeleteId(null);
            }
            }}
        />

        <ConfirmDialog
            open={confirmBulkDelete}
            title="Confirm"
            message={`Delete ${selectedIds.length} selected task${selectedIds.length > 1 ? "s" : ""} ?`}
            confirmText="Delete"
            onCancel={() => {
            if (!busyBulkAction) setConfirmBulkDelete(false);
            }}
            onConfirm={async () => {
            setConfirmBulkDelete(false);
            await bulkDeleteTasks();
            }}
        />

        <ConfirmDialogWide
        open={createOpen}
        title="Create task"
        confirmText={createBusy ? "Creating…" : "Create"}
        confirmTag="save"
        cancelText="Cancel"
        cancelTag="cancel"
        message={
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.9fr)]">
            <div className="min-w-0 space-y-4">
                <div>
                <FieldLabel>Title</FieldLabel>
                <input
                    className="h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder="Task title"
                    disabled={createBusy}
                />
                </div>

                <div>
                <FieldLabel>Description</FieldLabel>
                <MarkdownEditor
                value={draftDescription}
                onChange={setDraftDescription}
                disabled={createBusy}
                placeholder="Write a description..."
                />
                </div>
            </div>

            <div className="space-y-4">
                <div>
                <FieldLabel>Due date</FieldLabel>
                <input
                    type="datetime-local"
                    className="h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                    value={draftDueDate}
                    onChange={(e) => setDraftDueDate(e.target.value)}
                    disabled={createBusy}
                />
                </div>

                <div>
                <FieldLabel>Priority</FieldLabel>
                <select
                    className="h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                    value={draftPriority}
                    onChange={(e) => setDraftPriority(e.target.value as TaskPriority)}
                    disabled={createBusy}
                >
                    {priorityOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                    ))}
                </select>
                </div>

                <div>
                <FieldLabel>Owner</FieldLabel>
                <select
                    className="h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                    value={draftOwnerId}
                    onChange={(e) => setDraftOwnerId(e.target.value)}
                    disabled={createBusy}
                >
                    <option value="">Automatic</option>
                    {usersArr.map((u) => (
                    <option key={u.id} value={String(u.id)}>
                        {u.username}
                    </option>
                    ))}
                </select>
                </div>

                <div>
                <MultiSelectCombobox
                    label="Customers"
                    options={customerDropdownOptions}
                    value={draftCustomerIds}
                    onChange={(v) => setDraftCustomerIds(v)}
                    placeholder="-"
                    widthClass="w-full"
                />
                </div>
            </div>
            </div>
        }
        onCancel={() => {
            if (createBusy) return;
            setCreateOpen(false);
        }}
        onConfirm={async () => {
            if (createBusy) return;
            await onCreateTask();
        }}
        />
        </div>
    );
}