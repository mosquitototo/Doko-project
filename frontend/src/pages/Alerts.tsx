import { useEffect, useState, useRef, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import Card from "../components/ui/Card";
import StatusBadge from "../components/ui/StatusBadge";
import SeverityBadge from "../components/ui/SeverityBadge";
import ClassificationBadge from "../components/ui/ClassificationBadge";
import OutcomeBadge from "../components/ui/OutcomeBadge";
import { fetchAlerts, updateAlert, type AlertListItem } from "../api/alerts";
import { useToast } from "../components/ui/toast";
import {
  escalateAlert,
  mergeAlertIntoCase,
  deleteAlert,
} from "../api/alertsActions";
import AlertMergeDialog from "../components/ui/AlertMergeDialog";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { useMe } from "../contexts/MeContext";
import { fetchUsersLite, type UserLite } from "../api/usersLite";
import {
  listSeverities,
  listClassifications,
  type SeverityItem,
  type ClassificationItem,
} from "../api/dataModels";
import { listCustomers, type Customer } from "../api/settingsCustomers";
import {
  OpenCloseToggleButton,
  OpenInProgressCloseToggleButton,
  CloseButton,
  EditGenButton,
  MergeButton,
  AssignMeButton,
  OpenButton,
  DeleteButton,
  LeftButton,
  RightButton,
  ClearButton,
  PlayButton,
  Search, 
  SlidersHorizontal, 
  ChevronUp, 
  ChevronDown,
} from "../components/ui/IconButton";
import MultiSelectCombobox, {
  type MultiSelectComboboxOption,
} from "../components/ui/MultiSelectCombobox";
import SelectField from "../components/ui/SelectField";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function htmlToPlainText(html?: string | null) {
  if (!html) return "";
  if (typeof document === "undefined") {
    return String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  const el = document.createElement("div");
  el.innerHTML = html;
  return (el.textContent || el.innerText || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampLines(text: string) {
  return text || "—";
}

function asArray<T>(v: any): T[] {
  return Array.isArray(v) ? v : [];
}

function getAlertDisplayStatus(item: any): string {
  if (item?.case) return "merged";
  return String(item?.status ?? "");
}

function normalizeUsersLite(payload: any): UserLite[] {
  const raw = payload;
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.results)
    ? raw.results
    : [];
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

type SortKey =
  | "title"
  | "customer"
  | "severity"
  | "status"
  | "owner"
  | "outcome"
  | "created_at";

type SortDirection = "asc" | "desc";

function parseOrdering(ordering: string): {
  key: SortKey;
  direction: SortDirection;
} {
  const direction: SortDirection = ordering.startsWith("-") ? "desc" : "asc";
  const raw = ordering.replace(/^-/, "");
  const key: SortKey =
    raw === "title" ||
    raw === "customer" ||
    raw === "severity" ||
    raw === "status" ||
    raw === "owner" ||
    raw === "outcome" ||
    raw === "created_at"
      ? raw
      : "created_at";
  return { key, direction };
}

function compareNullableStrings(a: any, b: any) {
  return String(a || "").localeCompare(String(b || ""), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function formatOutcomeLabel(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";

  const predefined: Record<string, string> = {
    true_positive_with_impact: "TP with impact",
    true_positive_without_impact: "TP without impact",
    false_positive_technical: "FP technical",
    false_positive: "False positive",
    legitimate: "Legitimate",
    not_applicable: "Not applicable",
    unknown: "Unknown",
  };

  if (predefined[normalized]) return predefined[normalized];

  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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


function SlaBadge({ state }: { state?: string | null }) {
  const normalized = String(state || "").trim();

  if (!normalized || normalized === "none" || normalized === "completed") return null;

  const isOverdue = normalized === "overdue";
  const isOverdueCompleted = normalized === "overdue_completed";

  if (!isOverdue && !isOverdueCompleted) return null;

  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
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


export default function Alerts() {
  const me = useMe();
  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canMerge = can("alert.merge") || can("alert.escalate");
  const canUpdate = can("alert.update");
  const canDelete = can("alert.delete");

  const [items, setItems] = useState<AlertListItem[]>([]);
  const [serverCount, setServerCount] = useState(0);

  const itemsArr = useMemo(() => asArray<AlertListItem>(items), [items]);

  const [page, setPage] = useState(1);
  const pageSizeOptions = [10, 20, 50, 100];
  const [pageSize, setPageSize] = useState(20);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [customer, setCustomer] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>(["open","in_progress"]);
  const [owner, setOwner] = useState<string[]>([]);
  const [severity, setSeverity] = useState<string[]>([]);
  const [classification, setClassification] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<string[]>([]);
  const [ordering, setOrdering] = useState("-created_at");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);

  const navigate = useNavigate();
  const { push } = useToast();
  const [mergeUI, setMergeUI] = useState<{ alertId: string } | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const [sevOptions, setSevOptions] = useState<SeverityItem[]>([]);
  const [clsOptions, setClsOptions] = useState<ClassificationItem[]>([]);

  const sevOptionsArr = useMemo(
    () => asArray<SeverityItem>(sevOptions),
    [sevOptions]
  );
  const clsOptionsArr = useMemo(
    () => asArray<ClassificationItem>(clsOptions),
    [clsOptions]
  );

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedIds = useMemo(
    () => Object.keys(selected || {}).filter((id) => !!selected?.[id]),
    [selected]
  );

  const [users, setUsers] = useState<UserLite[]>([]);
  const usersArr = useMemo(() => asArray<UserLite>(users), [users]);

  useEffect(() => {
    fetchUsersLite()
      .then((payload: any) => setUsers(normalizeUsersLite(payload)))
      .catch(() => setUsers([]));
  }, []);

  const [editUI, setEditUI] = useState<{ ids: string[] } | null>(null);

  const [editCustomer, setEditCustomer] = useState<string>("");
  const [editSeverity, setEditSeverity] = useState<string>("");
  const [editClassification, setEditClassification] = useState<string>("");
  const [editOwnerId, setEditOwnerId] = useState<string>("");
  const [editStatus, setEditStatus] = useState<string>("");

  function openEdit(ids: string[]) {
    setEditCustomer("");
    setEditSeverity("");
    setEditClassification("");
    setEditOwnerId("");
    setEditStatus("");
    setEditUI({ ids });
  }

  const [customers, setCustomers] = useState<Customer[]>([]);
  const customersArr = useMemo(() => asArray<Customer>(customers), [customers]);

  const [confirmMixedCustomers, setConfirmMixedCustomers] = useState<{
    ids: string[];
    customerNames: string[];
  } | null>(null);

  function getSelectedCustomersInfo(ids: string[]) {
    const byId = new Map(itemsArr.map((a: any) => [a.id, a]));
    const seen = new Map<string, string>();

    for (const id of ids) {
      const a: any = byId.get(id);
      const cid = String(a?.customer ?? "");
      if (!cid) continue;
      const cname = String(a?.customer_name ?? cid);
      if (!seen.has(cid)) seen.set(cid, cname);
    }

    return Array.from(seen.values());
  }

  useEffect(() => {
    let mounted = true;
    listCustomers({ include_inactive: false })
      .then((r: any) => {
        if (!mounted) return;
        const arr = asArray<Customer>(r?.results).filter(
          (c: any) => !!c?.is_active
        );
        setCustomers(arr);
      })
      .catch(() => {
        if (!mounted) return;
        setCustomers([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([listSeverities(false), listClassifications(false)])
      .then(([s, c]: any) => {
        if (!mounted) return;
        setSevOptions(
          asArray<SeverityItem>(s).filter((x: any) => !!x?.is_active)
        );
        setClsOptions(
          asArray<ClassificationItem>(c).filter((x: any) => !!x?.is_active)
        );
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

  const severityOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    sevOptionsArr.forEach((item) => {
      map.set(String(item.code), Number(item.order));
    });
    return map;
  }, [sevOptionsArr]);

  const severityLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    sevOptionsArr.forEach((item) => {
      map.set(String(item.code), String(item.label));
    });
    return map;
  }, [sevOptionsArr]);

  const classificationLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    clsOptionsArr.forEach((item) => {
      map.set(String(item.code), String(item.label));
    });
    return map;
  }, [clsOptionsArr]);

  const customerLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    customersArr.forEach((item) => {
      map.set(String(item.id), String(item.name));
    });
    return map;
  }, [customersArr]);

  const ownerLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    usersArr.forEach((item) => {
      map.set(String(item.id), String(item.username));
    });
    return map;
  }, [usersArr]);

  const outcomeLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    itemsArr.forEach((item: any) => {
      const code = String(
        item?.outcome ??
          item?.outcome_code ??
          item?.outcome_value ??
          ""
      ).trim();

      const rawLabel = String(
        item?.outcome_label ??
          item?.outcome_display ??
          item?.outcome_name ??
          ""
      ).trim();

      if (code) {
        map.set(code, rawLabel || formatOutcomeLabel(code));
      }
    });
    return map;
  }, [itemsArr]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const alertQueryParams = useMemo(
    () => ({
      page,
      page_size: pageSize,
      search: search || undefined,
      customer,
      status,
      owner,
      severity,
      classification,
      outcome,
      ordering,
    }),
    [
      page,
      pageSize,
      search,
      customer,
      status,
      owner,
      severity,
      classification,
      outcome,
      ordering,
    ]
  );

  async function refreshAlertsPage() {
    setLoading(true);
    setError(null);

    try {
      const data: any = await fetchAlerts(alertQueryParams);
      setItems(asArray<AlertListItem>(data?.results));
      setServerCount(Number(data?.count ?? 0));
    } catch (e: any) {
      const msg = e?.response?.status
        ? `API error (${e.response.status})`
        : "Network error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;

    setLoading(true);
    setError(null);

    fetchAlerts(alertQueryParams)
      .then((data: any) => {
        if (!alive) return;
        setItems(asArray<AlertListItem>(data?.results));
        setServerCount(Number(data?.count ?? 0));
      })
      .catch((e: any) => {
        if (!alive) return;
        const msg = e?.response?.status
          ? `API error (${e.response.status})`
          : "Network error";
        setError(msg);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [alertQueryParams]);


  const outcomeDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
    () => [
      { value: "true_positive_with_impact", label: "TP with impact" },
      { value: "true_positive_without_impact", label: "TP without impact" },
      { value: "false_positive_technical", label: "FP technical" },
      { value: "false_positive", label: "False positive" },
      { value: "legitimate", label: "Legitimate" },
      { value: "not_applicable", label: "Not applicable" },
      { value: "unknown", label: "Unknown" },
    ],
    []
  );

  const sortMeta = useMemo(() => parseOrdering(ordering), [ordering]);

  const count = serverCount;
  const totalPages = Math.max(
    1,
    Math.ceil((Number(count) || 0) / (Number(pageSize) || 1))
  );

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pagedItems = itemsArr;

  const allOnPageSelected =
    pagedItems.length > 0 && pagedItems.every((x) => !!selected?.[x.id]);

  const someOnPageSelected = pagedItems.some((x) => !!selected?.[x.id]);
  const isIndeterminate = someOnPageSelected && !allOnPageSelected;
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const toggleAllOnPageVisible = (checked: boolean) => {
    setSelected((prev) => {
      const safePrev = prev || {};
      const next = { ...safePrev };
      pagedItems.forEach((x) => {
        next[x.id] = checked;
      });
      return next;
    });
  };

  async function bulkSetStatus(nextStatus: "open" | "in_progress" | "closed") {
    if (!canUpdate || selectedIds.length === 0) return;

    setBusyAction(true);
    try {
      await Promise.all(
        selectedIds.map((id) => updateAlert(id, { status: nextStatus } as any))
      );

      push({
        kind: "success",
        title:
          nextStatus === "closed"
            ? "Alerts closed"
            : nextStatus === "in_progress"
            ? "Alerts marked in progress"
            : "Alerts re-opened",
      });

      setItems((prev) =>
        asArray<AlertListItem>(prev).map((x) =>
          selected?.[x.id] ? { ...x, status: nextStatus } : x
        )
      );
      setSelected({});
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

  async function bulkDelete() {
    if (!canDelete || selectedIds.length === 0) return;

    setBusyAction(true);
    try {
      await Promise.all(selectedIds.map((id) => deleteAlert(id)));

      push({ kind: "success", title: "Alerts deleted" });

      setItems((prev) =>
        asArray<AlertListItem>(prev).filter((x) => !selected?.[x.id])
      );
      setSelected({});
      setServerCount((prev) => Math.max(0, prev - selectedIds.length));
      void refreshAlertsPage();
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

  const [bulkMergeUI, setBulkMergeUI] = useState(false);

  async function bulkMergeNewCase(forceCaseCustomerNull = false) {
    if (!canMerge || selectedIds.length === 0) return;
    setBusyAction(true);
    try {
      const first = selectedIds[0];

      const r0: any = await escalateAlert(first, {
        ...(forceCaseCustomerNull ? { force_case_customer_null: true } : {}),
        alert_ids: selectedIds,
      });

      const caseId = r0.case_id;

    push({ kind: "success", title: "Merged into case" });
    setItems((prev) =>
      asArray<AlertListItem>(prev).map((x: any) =>
        selectedIds.includes(x.id)
          ? {
              ...x,
              status: "merged",
              case: caseId,
            }
          : x
      )
    );
    setSelected({});
    setBulkMergeUI(false);
    navigate(`/cases/${caseId}`);
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network"),
      });
    } finally {
      setBusyAction(false);
    }
  }

  async function bulkMergeExistingCase(caseId: string) {
    if (!canMerge || selectedIds.length === 0) return;
    setBusyAction(true);
    try {
      for (const aid of selectedIds) {
        await mergeAlertIntoCase(aid, caseId);
      }
      push({ kind: "success", title: "Merged into case" });
      setItems((prev) =>
        asArray<AlertListItem>(prev).map((x: any) =>
          selectedIds.includes(x.id)
            ? {
                ...x,
                status: "merged",
                case: caseId,
              }
            : x
        )
      );
      setSelected({});
      setBulkMergeUI(false);
      navigate(`/cases/${caseId}`);
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

  useEffect(() => {
    setSelected({});
  }, [page, pageSize, search, customer, status, owner, severity, classification, outcome, ordering]);

  const customerDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
    () =>
      customersArr
        .slice()
        .sort((a, b) => (a?.name || "").localeCompare(b?.name || ""))
        .map((c) => ({ value: String(c.id), label: c.name })),
    [customersArr]
  );

  const statusDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
    () => [
      { value: "open", label: "Open" },
      { value: "in_progress", label: "In progress" },
      { value: "merged", label: "Merged" },
      { value: "closed", label: "Closed" },
    ],
    []
  );

  const ownerDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
    () =>
      usersArr
        .slice()
        .sort((a, b) => (a.username || "").localeCompare(b.username || ""))
        .map((u) => ({ value: String(u.id), label: u.username })),
    [usersArr]
  );

  const sevDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
    () =>
      sevOptionsArr
        .slice()
        .sort(
          (a, b) =>
            a.order - b.order || (a.label || "").localeCompare(b.label || "")
        )
        .map((s) => ({ value: s.code, label: s.label })),
    [sevOptionsArr]
  );

  const clsDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
    () =>
      clsOptionsArr
        .slice()
        .sort((a, b) => (a.label || "").localeCompare(b.label || ""))
        .map((c) => ({ value: c.code, label: c.label })),
    [clsOptionsArr]
  );

  function toggleSort(key: SortKey) {
    setPage(1);
    setOrdering((prev) => {
      const current = parseOrdering(prev);
      if (current.key === key) {
        return current.direction === "asc" ? `-${key}` : key;
      }
      if (key === "created_at") return "-created_at";
      return key;
    });
  }

  const clearFilters = () => {
    setPage(1);
    setCustomer([]);
    setStatus(["open","in_progress"]);
    setOwner([]);
    setSeverity([]);
    setClassification([]);
    setOutcome([]);
    setSearchInput("");
    setSearch("");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-3xl font-semibold tracking-tight text-foreground">
            Alerts
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {count} total in the current scope
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Creation is API-only
        </div>
      </div>

      <Card className="relative z-20 overflow-visible p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center justify-center">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div className="ml-2">
              <div className="text-sm font-semibold text-foreground">Filters</div>
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
                    placeholder="Title or description…"
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

            <div className="relative z-30 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
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
                  label="Severity"
                  options={sevDropdownOptions}
                  value={severity}
                  onChange={(v) => {
                    setPage(1);
                    setSeverity(v);
                  }}
                  placeholder="-"
                  widthClass="w-full"
                />
              </div>

              <div className="min-w-0 text-xs">
                <MultiSelectCombobox
                  label="Classification"
                  options={clsDropdownOptions}
                  value={classification}
                  onChange={(v) => {
                    setPage(1);
                    setClassification(v);
                  }}
                  placeholder="-"
                  widthClass="w-full"
                />
              </div>

              <div className="min-w-0 text-xs sm:col-span-2 xl:col-span-5">
                <div className="max-w-[240px]">
                  <MultiSelectCombobox
                    label="Outcome"
                    options={outcomeDropdownOptions}
                    value={outcome}
                    onChange={(v) => {
                      setPage(1);
                      setOutcome(v);
                    }}
                    placeholder="-"
                    widthClass="w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="relative z-0 overflow-hidden p-0">
        {error ? (
          <div className="border-b border-destructive/20 bg-destructive/10 px-5 py-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {selectedIds.length > 0 ? (
          <div className="border-b border-border bg-background/70 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-foreground">
                {selectedIds.length} selected
              </div>

              <div className="flex flex-wrap gap-2">
                <EditGenButton
                  disabled={busyAction || !canUpdate}
                  onClick={() => openEdit(selectedIds)}
                  type="button"
                  className="text-xs px-2"
                  iconOnly={false}
                  label="Edit"
                  title="Edit"
                />

                <MergeButton
                  disabled={busyAction || !canMerge}
                  onClick={() => setBulkMergeUI(true)}
                  type="button"
                  className="text-xs px-2"
                  iconOnly={false}
                  label="Merge"
                  title="Merge"
                />

                <CloseButton
                  disabled={busyAction || !canUpdate}
                  onClick={async () => {
                    await bulkSetStatus("closed");
                  }}
                  type="button"
                  className="text-xs px-2"
                  iconOnly={false}
                  label="Close"
                  title="Close"
                />

                <PlayButton
                  disabled={busyAction || !canUpdate}
                  onClick={async () => {
                    await bulkSetStatus("in_progress");
                  }}
                  type="button"
                  className="text-xs px-2"
                  iconOnly={false}
                  label="In progress"
                  title="Mark as in progress"
                />

                <OpenButton
                  disabled={busyAction || !canUpdate}
                  onClick={async () => {
                    await bulkSetStatus("open");
                  }}
                  type="button"
                  className="text-xs px-2"
                  iconOnly={false}
                  label="Re-open"
                  title="Re-open"
                />

                <DeleteButton
                  disabled={busyAction || !canDelete}
                  onClick={() => setConfirmBulkDelete(true)}
                  type="button"
                  className="text-xs px-2"
                  iconOnly={false}
                  label="Delete"
                  title="Delete"
                />
              </div>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-16 w-full animate-pulse rounded-2xl bg-muted"
              />
            ))}
          </div>
        ) : pagedItems.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="text-lg font-semibold text-foreground">
              No alerts
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Waiting for alerts via API.
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <div className="min-w-[1040px] 2xl:min-w-[1320px]">
                <div className="grid grid-cols-[28px_minmax(0,1.45fr)_84px_80px_84px_minmax(0,0.68fr)_80px_84px_100px] gap-2 border-b border-border bg-background/70 px-3 2xl:px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground whitespace-nowrap 2xl:grid-cols-[30px_minmax(0,1.9fr)_102px_96px_100px_minmax(0,0.9fr)_96px_96px_118px]">
                  <div className="flex items-center justify-center">
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={(e) => toggleAllOnPageVisible(e.target.checked)}
                      disabled={busyAction || pagedItems.length === 0}
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
                    label="Customer"
                    active={sortMeta.key === "customer"}
                    direction={sortMeta.direction}
                    onClick={() => toggleSort("customer")}
                  />

                  <HeaderSortLabel
                    label="Severity"
                    active={sortMeta.key === "severity"}
                    direction={sortMeta.direction}
                    onClick={() => toggleSort("severity")}
                  />

                  <HeaderSortLabel
                    label="Status"
                    active={sortMeta.key === "status"}
                    direction={sortMeta.direction}
                    onClick={() => toggleSort("status")}
                  />

                  <HeaderSortLabel
                    label="Outcome"
                    active={sortMeta.key === "outcome"}
                    direction={sortMeta.direction}
                    onClick={() => toggleSort("outcome")}
                  />

                  <HeaderSortLabel
                    label="Owner"
                    active={sortMeta.key === "owner"}
                    direction={sortMeta.direction}
                    onClick={() => toggleSort("owner")}
                  />

                  <div className="flex items-center justify-center whitespace-nowrap text-center">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Quick actions
                    </span>
                  </div>

                  <HeaderSortLabel
                    label="Created"
                    active={sortMeta.key === "created_at"}
                    direction={sortMeta.direction}
                    onClick={() => toggleSort("created_at")}
                    align="right"
                  />
                </div>

                <div className="divide-y divide-border">
                  {pagedItems.map((a: any) => {
                    const outcomeCode = String(
                      a?.outcome ?? a?.outcome_code ?? a?.outcome_value ?? ""
                    ).trim();
                    const outcomeLabel =
                      String(
                        a?.outcome_label ??
                          a?.outcome_display ??
                          a?.outcome_name ??
                          ""
                      ).trim() || outcomeLabelMap.get(outcomeCode) || outcomeCode;

                    return (
                      <div
                        key={a.id}
                        className="px-3 2xl:px-4 py-4 transition hover:bg-accent/40"
                      >
                        <div className="grid grid-cols-[28px_minmax(0,1.45fr)_84px_80px_84px_minmax(0,0.68fr)_80px_84px_100px] items-center gap-2 2xl:grid-cols-[30px_minmax(0,1.9fr)_102px_96px_100px_minmax(0,0.9fr)_96px_96px_118px]">
                          <div className="flex items-center justify-center">
                            <input
                              type="checkbox"
                              checked={!!selected?.[a.id]}
                              onChange={(e) =>
                                setSelected((prev) => ({
                                  ...(prev || {}),
                                  [a.id]: e.target.checked,
                                }))
                              }
                              disabled={busyAction}
                              className="h-4 w-4"
                            />
                          </div>

                          <div className="min-w-0">
                            <Link
                              to={`/alerts/${a.id}`}
                              className="block truncate text-sm font-semibold text-foreground"
                            >
                              {a.title}
                            </Link>

                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <SlaBadge state={(a as any).sla_state} />
                              <ClassificationBadge
                                value={a.classification ?? undefined}
                              />
                            </div>

                            <div
                              className="mt-2 mr-1 line-clamp-1 text-xs text-muted-foreground"
                              title={clampLines(htmlToPlainText(a.description))}
                            >
                              {clampLines(htmlToPlainText(a.description))}
                            </div>

                            {a.case ? (
                              <div className="mt-2">
                                <Link
                                  to={`/cases/${a.case}`}
                                  className="inline-flex items-center rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-medium italic transition hover:bg-accent hover:text-foreground"
                                  title={`Open case #${a.case}`}
                                >
                                  Case #{a.case}
                                </Link>
                              </div>
                            ) : null}
                          </div>

                          <div className="min-w-0 text-xs text-muted-foreground">
                            <div className="truncate" title={a.customer_name || ""}>
                              {a.customer_name || customerLabelMap.get(String(a.customer ?? "")) || "—"}
                            </div>
                          </div>

                          <div className="flex">
                            <SeverityBadge value={a.severity} />
                          </div>

                          <div className="flex">
                            <StatusBadge status={getAlertDisplayStatus(a)} />
                          </div>

                          <div className="flex min-w-0">
                            <OutcomeBadge value={outcomeCode || undefined} />
                          </div>

                          <div className="min-w-0 text-xs text-muted-foreground">
                            <div
                              className="truncate"
                              title={a.owner_username || ""}
                            >
                              {a.owner_username ||
                                ownerLabelMap.get(String(a.owner_id ?? a.owner ?? "")) ||
                                "—"}
                            </div>
                          </div>

                          <div>
                            <div className="grid grid-cols-2 gap-2">
                              <AssignMeButton
                                disabled={busyAction || !me?.id || !canUpdate}
                                onClick={async () => {
                                  if (!me?.id || !canUpdate) return;
                                  setBusyAction(true);
                                  try {
                                    await updateAlert(a.id, { owner: me.id } as any);
                                    push({
                                      kind: "success",
                                      title: "Alert assigned to you",
                                    });
                                    setItems((prev) =>
                                      prev.map((x: any) =>
                                        x.id === a.id
                                          ? {
                                              ...x,
                                              owner_id: me.id,
                                              owner_username: me.username,
                                            }
                                          : x
                                      )
                                    );
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
                                type="button"
                              />

                              <EditGenButton
                                disabled={busyAction || !canUpdate}
                                onClick={() => openEdit([a.id])}
                                type="button"
                              />

                              {canMerge ? (
                                <MergeButton
                                  disabled={busyAction || !canMerge}
                                  onClick={() => setMergeUI({ alertId: a.id })}
                                  type="button"
                                />
                              ) : (
                                <div />
                              )}

                              <OpenInProgressCloseToggleButton
                                status={getAlertDisplayStatus(a)}
                                disabled={busyAction || !canUpdate || getAlertDisplayStatus(a) === "merged"}
                                onClick={async () => {
                                  const currentStatus = getAlertDisplayStatus(a);

                                  const nextStatus =
                                    currentStatus === "open"
                                      ? "in_progress"
                                      : currentStatus === "in_progress"
                                      ? "closed"
                                      : "open";

                                  setBusyAction(true);

                                  try {
                                    await updateAlert(a.id, { status: nextStatus } as any);

                                    push({
                                      kind: "success",
                                      title:
                                        nextStatus === "closed"
                                          ? "Alert closed"
                                          : nextStatus === "in_progress"
                                          ? "Alert marked in progress"
                                          : "Alert re-opened",
                                    });

                                    setItems((prev) =>
                                      asArray<AlertListItem>(prev).map((x: any) =>
                                        x.id === a.id ? { ...x, status: nextStatus } : x
                                      )
                                    );
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
                                type="button"
                              />
                            </div>
                          </div>

                          <div className="text-right text-[11px] text-muted-foreground text-wrap whitespace-nowrap">
                            {formatDate(a.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
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

      <AlertMergeDialog
        open={!!mergeUI}
        busy={busyAction}
        onCancel={() => setMergeUI(null)}
        onConfirmNew={async () => {
          if (!mergeUI || !canMerge) return;
          setBusyAction(true);

          try {
            const r: any = await escalateAlert(mergeUI.alertId);

            if (r.already_linked) {
              push({
                kind: "info",
                title: "Already linked",
                message: "This alert is already linked to a case.",
              });
              setMergeUI(null);
              navigate(`/cases/${r.case_id}`);
              return;
            }

          push({
            kind: "success",
            title: r.created_case ? "Case created" : "Escalated",
          });
          setItems((prev) =>
            asArray<AlertListItem>(prev).map((x: any) =>
              x.id === mergeUI.alertId
                ? {
                    ...x,
                    status: "merged",
                    case: r.case_id,
                  }
                : x
            )
          );
          setMergeUI(null);
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
            const r: any = await mergeAlertIntoCase(mergeUI.alertId, caseId);

            if (r.already_linked) {
              push({
                kind: "info",
                title: "Already linked",
                message: "This alert is already linked to this case.",
              });
              setMergeUI(null);
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
              setItems((prev) =>
                asArray<AlertListItem>(prev).map((x: any) =>
                  x.id === mergeUI.alertId
                    ? {
                        ...x,
                        status: "merged",
                        case: r.case_id,
                      }
                    : x
                )
              );
              setMergeUI(null);
              navigate(`/cases/${r.case_id}`);
              return;
            }

            push({ kind: "error", title: "Unexpected response" });
          } catch (e: any) {
            const statusCode = e?.response?.status;
            const data = e?.response?.data;

            if (statusCode === 409 && data?.conflict && data?.current_case_id) {
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
              message: String(data?.error ?? statusCode ?? "network"),
            });
          } finally {
            setBusyAction(false);
          }
        }}
      />

      <AlertMergeDialog
        open={bulkMergeUI}
        busy={busyAction}
        onCancel={() => setBulkMergeUI(false)}
        onConfirmNew={async () => {
          if (selectedIds.length === 0) return;

          const customerNames = getSelectedCustomersInfo(selectedIds);
          if (customerNames.length > 1) {
            setConfirmMixedCustomers({ ids: selectedIds, customerNames });
            return;
          }

          await bulkMergeNewCase(false);
        }}
        onConfirmExisting={bulkMergeExistingCase}
      />

      <ConfirmDialog
        open={!!confirmMixedCustomers}
        title="Warning"
        confirmText="Continue"
        confirmTag="merge"
        cancelText="Cancel"
        cancelTag="cancel"
        message={
          confirmMixedCustomers ? (
            <div className="space-y-2">
              <div className="text-sm text-foreground">
                You are merging alerts with different customers into a new case:
              </div>
              <ul className="list-disc pl-5 text-sm text-foreground">
                {confirmMixedCustomers.customerNames.slice(0, 6).map((n) => (
                  <li key={n}>{n}</li>
                ))}
                {confirmMixedCustomers.customerNames.length > 6 ? (
                  <li>…</li>
                ) : null}
              </ul>
              <div className="text-xs text-muted-foreground">
                If you continue, the case will be created without a customer.
              </div>
            </div>
          ) : null
        }
        onCancel={() => {
          if (busyAction) return;
          setConfirmMixedCustomers(null);
        }}
        onConfirm={async () => {
          if (!confirmMixedCustomers || busyAction) return;
          setConfirmMixedCustomers(null);
          await bulkMergeNewCase(true);
        }}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Confirm"
        message={confirmDelete ? `Delete alert "${confirmDelete.title}" ?` : ""}
        confirmText="Delete"
        confirmTag="delete"
        cancelText="Cancel"
        cancelTag="cancel"
        onCancel={() => {
          if (busyAction) return;
          setConfirmDelete(null);
        }}
        onConfirm={async () => {
          if (!confirmDelete || busyAction || !canDelete) return;
          const target = confirmDelete;
          setConfirmDelete(null);

          setBusyAction(true);
          try {
            await deleteAlert(target.id);
            push({ kind: "success", title: "Alert deleted" });
            setItems((prev) =>
              asArray<AlertListItem>(prev).filter((x) => x.id !== target.id)
            );
            setServerCount((prev) => Math.max(0, prev - 1));
            void refreshAlertsPage();
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

      <ConfirmDialog
        open={!!editUI}
        title={
          editUI && editUI.ids.length > 1
            ? `Edit ${editUI.ids.length} alerts`
            : "Edit alert"
        }
        confirmText="Save"
        confirmTag="save"
        cancelText="Cancel"
        cancelTag="cancel"
        size="xl"
        message={
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <FieldLabel>Customer</FieldLabel>
              <select
                className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                value={editCustomer}
                onChange={(e) => setEditCustomer(e.target.value)}
                disabled={busyAction || !canUpdate}
              >
                <option value="">— no change</option>
                <option value="__NULL__">— clear</option>
                {customersArr
                  .slice()
                  .sort((a, b) => (a?.name || "").localeCompare(b?.name || ""))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid gap-1">
              <FieldLabel>Severity</FieldLabel>
              <select
                className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                value={editSeverity}
                onChange={(e) => setEditSeverity(e.target.value)}
                disabled={busyAction || !canUpdate}
              >
                <option value="">— no change</option>
                {sevOptionsArr
                  .slice()
                  .sort(
                    (a, b) =>
                      a.order - b.order ||
                      (a.label || "").localeCompare(b.label || "")
                  )
                  .map((s) => (
                    <option key={s.id} value={s.code}>
                      {s.label}
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid gap-1">
              <FieldLabel>Classification</FieldLabel>
              <select
                className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                value={editClassification}
                onChange={(e) => setEditClassification(e.target.value)}
                disabled={busyAction || !canUpdate}
              >
                <option value="">— no change</option>
                {clsOptionsArr
                  .slice()
                  .sort((a, b) => (a.label || "").localeCompare(b.label || ""))
                  .map((c) => (
                    <option key={c.id} value={c.code}>
                      {c.label}
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid gap-1">
              <FieldLabel>Owner</FieldLabel>
              <select
                className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                value={editOwnerId}
                onChange={(e) => setEditOwnerId(e.target.value)}
                disabled={busyAction || !canUpdate}
              >
                <option value="">— no change</option>
                <option value="__NULL__">— clear</option>
                {usersArr.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.username}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1">
              <FieldLabel>Status</FieldLabel>
              <select
                className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                disabled={busyAction || !canUpdate}
              >
                <option value="">— no change</option>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            <div className="sm:col-span-2 text-[11px] text-muted-foreground">
              “— no change” leaves the field as-is. “clear” removes the value.
            </div>
          </div>
        }
        onCancel={() => {
          if (busyAction) return;
          setEditUI(null);
        }}
        onConfirm={async () => {
          if (!editUI || busyAction || !canUpdate) return;

          const ids = editUI.ids || [];
          if (ids.length === 0) return;

          const payload: any = {};

          if (editCustomer === "__NULL__") payload.customer = null;
          else if (editCustomer !== "") payload.customer = editCustomer;

          if (editSeverity !== "") payload.severity = editSeverity;
          if (editClassification !== "") payload.classification = editClassification;
          if (editStatus !== "") payload.status = editStatus;

          if (editOwnerId === "__NULL__") payload.owner = null;
          else if (editOwnerId !== "") payload.owner = editOwnerId;

          if (Object.keys(payload).length === 0) {
            push({ kind: "info", title: "Nothing to save" });
            setEditUI(null);
            return;
          }

          setBusyAction(true);
          try {
            await Promise.all(ids.map((id) => updateAlert(id, payload)));

            push({
              kind: "success",
              title: ids.length > 1 ? "Alerts updated" : "Alert updated",
            });

            setEditUI(null);
            setSelected({});
            await refreshAlertsPage();
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

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Confirm"
        message={`Delete ${selectedIds.length} alert(s) ?`}
        confirmTag="delete"
        cancelTag="warning"
        onCancel={() => {
          if (busyAction) return;
          setConfirmBulkDelete(false);
        }}
        onConfirm={async () => {
          if (busyAction || !canDelete) return;
          setConfirmBulkDelete(false);
          await bulkDelete();
        }}
      />
    </div>
  );
}