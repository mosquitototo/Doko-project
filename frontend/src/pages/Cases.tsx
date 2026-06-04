import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Card from "../components/ui/Card";
import StatusBadge from "../components/ui/StatusBadge";
import {
  fetchTickets,
  updateTicket,
  deleteCase,
  type EventListItem,
} from "../api/cases";
import { fetchUsersLite, type UserLite } from "../api/usersLite";
import SeverityBadge from "../components/ui/SeverityBadge";
import ClassificationBadge from "../components/ui/ClassificationBadge";
import OutcomeBadge from "../components/ui/OutcomeBadge";
import { useToast } from "../components/ui/toast";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import {
  listSeverities,
  listClassifications,
  type SeverityItem,
  type ClassificationItem,
} from "../api/dataModels";
import { listCustomers, type Customer } from "../api/settingsCustomers";
import { useMe } from "../contexts/MeContext";
import {
  NewGenButton,
  LeftButton,
  RightButton,
  DeleteButton,
  EditGenButton,
  CloseButton,
  OpenButton,
  ClearButton,
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
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const pageSizeOptions = [10, 20, 50, 100];

const statusOptions = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
  { value: "archived", label: "Archived" },
];

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


function RecentActivityDot({
  active,
  kind,
}: {
  active?: boolean;
  kind?: string | null;
}) {
  if (!active) return null;

  const title =
    kind === "auto_followup"
      ? "Recent automatic follow-up"
      : kind === "inbound_exchange"
      ? "Recent inbound message"
      : kind === "comment"
      ? "Recent comment"
      : "Recent activity";

  return (
    <span
      className="inline-flex h-2.5 w-2.5 rounded-full bg-sky-500"
      title={title}
      aria-label={title}
    />
  );
}

type SortKey =
  | "title"
  | "status"
  | "severity"
  | "outcome"
  | "customer"
  | "owner"
  | "updated_at";

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
    raw === "severity" ||
    raw === "outcome" ||
    raw === "customer" ||
    raw === "owner" ||
    raw === "updated_at"
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



export default function Tickets() {
  const [items, setItems] = useState<EventListItem[]>([]);
  const [serverCount, setServerCount] = useState(0);

  const itemsArr = useMemo(
    () => (Array.isArray(items) ? items : []),
    [items]
  );

  const [status, setStatus] = useState<string[]>([]);
  const [owner, setOwner] = useState<string[]>([]);
  const [classification, setClassification] = useState<string[]>([]);
  const [severity, setSeverity] = useState<string[]>([]);
  const [customer, setCustomer] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<string[]>([]);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [ordering, setOrdering] = useState("-updated_at");

  const [includeArchived, setIncludeArchived] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { push } = useToast();

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
  const customersArr = useMemo(
    () => (Array.isArray(customers) ? customers : []),
    [customers]
  );

  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
  const [busyBulkAction, setBusyBulkAction] = useState(false);

  const me = useMe();
  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canDeleteCase = can("case.delete");
  const canAddCase = can("case.add");
  const canUpdateCase = can("case.update");

  const [sevOptions, setSevOptions] = useState<SeverityItem[]>([]);
  const [clsOptions, setClsOptions] = useState<ClassificationItem[]>([]);

  const [editUI, setEditUI] = useState<{ ids: string[] } | null>(null);
  const [editCustomer, setEditCustomer] = useState<string>("");
  const [editSeverity, setEditSeverity] = useState<string>("");
  const [editClassification, setEditClassification] = useState<string>("");
  const [editOwnerId, setEditOwnerId] = useState<string>("");

  function openEdit(ids: string[]) {
    setEditCustomer("");
    setEditSeverity("");
    setEditClassification("");
    setEditOwnerId("");
    setEditUI({ ids });
  }

  const caseQueryParams = useMemo(
    () => ({
      page,
      page_size: pageSize,
      search: search || undefined,
      status,
      owner,
      severity,
      classification,
      customer,
      outcome,
      ordering,
      include_archived: includeArchived ? "1" : undefined,
    }),
    [
      page,
      pageSize,
      search,
      status,
      owner,
      severity,
      classification,
      customer,
      outcome,
      ordering,
      includeArchived,
    ]
  );

  async function refreshCasesPage() {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchTickets(caseQueryParams);
      setItems(Array.isArray(data?.results) ? data.results : []);
      setServerCount(Number(data?.count ?? 0));
    } catch (e: any) {
      const msg = e?.response?.status
        ? `Erreur API (${e.response.status})`
        : "Erreur réseau";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    fetchTickets(caseQueryParams)
      .then((data) => {
        if (!mounted) return;
        setItems(Array.isArray(data?.results) ? data.results : []);
        setServerCount(Number(data?.count ?? 0));
      })
      .catch((e) => {
        if (!mounted) return;
        const msg = e?.response?.status
          ? `Erreur API (${e.response.status})`
          : "Erreur réseau";
        setError(msg);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [caseQueryParams]);

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

  useEffect(() => {
    let mounted = true;
    Promise.all([listSeverities(false), listClassifications(false)])
      .then(([s, c]) => {
        if (!mounted) return;
        setSevOptions((Array.isArray(s) ? s : []).filter((x) => x.is_active));
        setClsOptions((Array.isArray(c) ? c : []).filter((x) => x.is_active));
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
    sevOptions.forEach((item) => {
      map.set(String(item.code), Number(item.order));
    });
    return map;
  }, [sevOptions]);

  const statusDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
    () => statusOptions.map((o) => ({ value: o.value, label: o.label })),
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

  const sevDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
    () =>
      sevOptions
        .slice()
        .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
        .map((s) => ({ value: s.code, label: s.label })),
    [sevOptions]
  );

  const clsDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
    () =>
      clsOptions
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((c) => ({ value: c.code, label: c.label })),
    [clsOptions]
  );

  const outcomeDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
    () =>
      Array.from(
        new Set(
          itemsArr
            .map((t: any) => String(t?.outcome || "").trim())
            .filter(Boolean)
        )
      )
        .sort((a, b) =>
          formatOutcomeLabel(a).localeCompare(formatOutcomeLabel(b))
        )
        .map((value) => ({
          value,
          label: formatOutcomeLabel(value),
        })),
    [itemsArr]
  );

  const sortMeta = useMemo(() => parseOrdering(ordering), [ordering]);

  const count = serverCount;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pagedItems = itemsArr;

  const selectedIds = useMemo(
    () => Object.keys(selected || {}).filter((id) => !!selected?.[id]),
    [selected]
  );

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

  async function bulkDeleteCases() {
    if (selectedIds.length === 0) return;

    setBusyBulkAction(true);
    try {
      await Promise.all(selectedIds.map((id) => deleteCase(id)));
      push({ kind: "success", title: "Cases deleted" });
      setItems((prev) => prev.filter((x) => !selected?.[x.id]));
      setSelected({});
      setServerCount((prev) => Math.max(0, prev - selectedIds.length));
      void refreshCasesPage();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
    } finally {
      setBusyBulkAction(false);
    }
  }

  async function bulkSetStatus(nextStatus: "open" | "closed") {
    if (!canUpdateCase) return;
    if (selectedIds.length === 0) return;

    setBusyBulkAction(true);
    try {
      await Promise.all(
        selectedIds.map((id) => updateTicket(id, { status: nextStatus } as any))
      );

      push({
        kind: "success",
        title: nextStatus === "closed" ? "Cases closed" : "Cases re-opened",
      });

      setItems((prev) =>
        prev.map((x) => (selected?.[x.id] ? { ...x, status: nextStatus } : x))
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
      setBusyBulkAction(false);
    }
  }

  useEffect(() => {
    setSelected({});
  }, [
    page,
    pageSize,
    search,
    ordering,
    includeArchived,
    status,
    owner,
    classification,
    severity,
    customer,
    outcome,
  ]);

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
    setOwner([]);
    setSeverity([]);
    setClassification([]);
    setCustomer([]);
    setOutcome([]);
    setSearchInput("");
    setSearch("");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-3xl font-semibold tracking-tight text-foreground">
            Cases
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {count} total in the current scope
            {serverCount > 1000 ? ` • first 1000 loaded` : ""}
          </div>
        </div>

        {canAddCase ? (
          <NewGenButton
            onClick={() => navigate("/cases/new")}
            iconOnly={false}
            label="New case"
            title="New case"
          />
        ) : null}
      </div>

      <Card className="relative z-20 overflow-visible p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Filters</div>
              <div className="text-xs text-muted-foreground">
                Narrow the visible case scope
              </div>
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
                    placeholder="Case number, title or description…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={includeArchived}
                    onChange={(e) => {
                      setPage(1);
                      setIncludeArchived(e.target.checked);
                    }}
                  />
                  <span>Include archived cases</span>
                </label>

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
                  disabled={busyBulkAction || !canUpdateCase}
                  onClick={() => openEdit(selectedIds)}
                  type="button"
                  className="text-xs px-2"
                  iconOnly={false}
                  label="Edit"
                  title="Edit"
                />

                <CloseButton
                  disabled={busyBulkAction || !canUpdateCase}
                  onClick={async () => {
                    await bulkSetStatus("closed");
                  }}
                  type="button"
                  className="text-xs px-2"
                  iconOnly={false}
                  label="Close"
                  title="Close"
                />

                <OpenButton
                  disabled={busyBulkAction || !canUpdateCase}
                  onClick={async () => {
                    await bulkSetStatus("open");
                  }}
                  type="button"
                  className="text-xs px-2"
                  iconOnly={false}
                  label="Re-open"
                  title="Re-open"
                />

                {canDeleteCase ? (
                  <DeleteButton
                    disabled={busyBulkAction || !canDeleteCase}
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
              <div
                key={i}
                className="h-16 w-full animate-pulse rounded-2xl bg-muted"
              />
            ))}
          </div>
        ) : pagedItems.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="text-lg font-semibold text-foreground">
              No case found
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Try adjusting filters or creating a new case.
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <div className="min-w-[1080px]">
                <div className="grid grid-cols-[30px_minmax(0,2.9fr)_102px_96px_minmax(0,0.95fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_116px] gap-2 border-b border-border bg-background/70 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
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
                    label="Severity"
                    active={sortMeta.key === "severity"}
                    direction={sortMeta.direction}
                    onClick={() => toggleSort("severity")}
                  />

                  <HeaderSortLabel
                    label="Outcome"
                    active={sortMeta.key === "outcome"}
                    direction={sortMeta.direction}
                    onClick={() => toggleSort("outcome")}
                  />

                  <HeaderSortLabel
                    label="Customer"
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

                  <HeaderSortLabel
                    label="Updated"
                    active={sortMeta.key === "updated_at"}
                    direction={sortMeta.direction}
                    onClick={() => toggleSort("updated_at")}
                    align="right"
                  />
                </div>

                <div className="divide-y divide-border">
                  {pagedItems.map((t: any) => (
                    <div
                      key={t.id}
                      className="px-4 py-4 transition hover:bg-accent/40"
                    >
                      <div className="grid grid-cols-[30px_minmax(0,2.9fr)_102px_96px_minmax(0,0.95fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_116px] items-center gap-2">
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
                            <RecentActivityDot
                              active={!!t.has_recent_activity}
                              kind={t.recent_activity_kind}
                            />

                            <Link
                              to={`/cases/${t.id}`}
                              className="block min-w-0 truncate text-sm font-semibold text-foreground"
                              title={t.title}
                            >
                              {t.case_number ? `#${t.case_number} — ` : ""}
                              {t.title}
                            </Link>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <ClassificationBadge
                              value={t.classification ?? undefined}
                            />
                          </div>

                          <div
                            className="mt-2 line-clamp-1 text-xs text-muted-foreground"
                            title={htmlToPlainText(t.description) || "—"}
                          >
                            {htmlToPlainText(t.description) || "—"}
                          </div>
                        </div>

                        <div className="flex">
                          <StatusBadge status={t.status} />
                        </div>

                        <div className="flex">
                          <SeverityBadge value={t.severity ?? undefined} />
                        </div>

                        <div className="min-w-0">
                          <OutcomeBadge value={(t as any).outcome ?? undefined} />
                        </div>

                        <div className="min-w-0 text-xs text-muted-foreground">
                          <div
                            className="truncate"
                            title={t.customer_name || ""}
                          >
                            {t.customer_name || "—"}
                          </div>
                        </div>

                        <div className="min-w-0 text-xs text-muted-foreground">
                          <div
                            className="truncate"
                            title={t.owner_username || ""}
                          >
                            {t.owner_username || "—"}
                          </div>
                        </div>

                        <div className="text-right text-[11px] text-muted-foreground">
                          {formatDate(t.updated_at)}
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

      <ConfirmDialog
        open={!!confirmDelete}
        title="Confirm"
        message={confirmDelete ? `Delete case "${confirmDelete.title}" ?` : ""}
        confirmText="Delete"
        onCancel={() => {
          if (busyDeleteId) return;
          setConfirmDelete(null);
        }}
        onConfirm={async () => {
          if (!confirmDelete || !canDeleteCase) return;
          const target = confirmDelete;
          setConfirmDelete(null);

          setBusyDeleteId(target.id);
          try {
            await deleteCase(target.id);
            push({ kind: "success", title: "Case deleted" });
            setItems((prev) => prev.filter((x) => x.id !== target.id));
            setServerCount((prev) => Math.max(0, prev - 1));
            void refreshCasesPage();
          } catch (e: any) {
            push({
              kind: "error",
              title: "Error",
              message: String(e?.response?.status ?? "network"),
            });
          } finally {
            setBusyDeleteId(null);
          }
        }}
      />

      <ConfirmDialog
        open={!!editUI}
        title={
          editUI && editUI.ids.length > 1
            ? `Edit ${editUI.ids.length} cases`
            : "Edit case"
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
                disabled={busyBulkAction}
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
                disabled={busyBulkAction}
              >
                <option value="">— no change</option>
                {sevOptions
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
                disabled={busyBulkAction}
              >
                <option value="">— no change</option>
                {clsOptions
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
                disabled={busyBulkAction}
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

            <div className="sm:col-span-2 text-[11px] text-muted-foreground">
              “no change” leaves the field as-is. “clear” removes the value.
            </div>
          </div>
        }
        onCancel={() => {
          if (busyBulkAction) return;
          setEditUI(null);
        }}
        onConfirm={async () => {
          if (!editUI || busyBulkAction) return;

          const ids = editUI.ids || [];
          if (ids.length === 0) return;

          const payload: any = {};

          if (editCustomer === "__NULL__") payload.customer = null;
          else if (editCustomer !== "") payload.customer = editCustomer;

          if (editSeverity !== "") payload.severity = editSeverity;
          if (editClassification !== "") payload.classification = editClassification;

          if (editOwnerId === "__NULL__") payload.owner_id = null;
          else if (editOwnerId !== "") payload.owner_id = Number(editOwnerId);

          if (Object.keys(payload).length === 0) {
            push({ kind: "info", title: "Nothing to save" });
            setEditUI(null);
            return;
          }

          setBusyBulkAction(true);
          try {
            await Promise.all(ids.map((id) => updateTicket(id, payload)));

            push({
              kind: "success",
              title: ids.length > 1 ? "Cases updated" : "Case updated",
            });

            setEditUI(null);
            setSelected({});

            await refreshCasesPage();
          } catch (e: any) {
            push({
              kind: "error",
              title: "Error",
              message: String(e?.response?.status ?? "network"),
            });
          } finally {
            setBusyBulkAction(false);
          }
        }}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Confirm"
        message={`Delete ${selectedIds.length} case(s) ?`}
        confirmTag="delete"
        cancelTag="warning"
        onCancel={() => {
          if (busyBulkAction) return;
          setConfirmBulkDelete(false);
        }}
        onConfirm={async () => {
          if (busyBulkAction || !canDeleteCase) return;
          setConfirmBulkDelete(false);
          await bulkDeleteCases();
        }}
      />
    </div>
  );
}