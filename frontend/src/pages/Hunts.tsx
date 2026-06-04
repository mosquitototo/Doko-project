import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import Card from "../components/ui/Card";
import StatusBadge from "../components/ui/StatusBadge";
import { fetchHunts, createHunt, type HuntListItem } from "../api/hunts";
import { listCustomers, type Customer } from "../api/settingsCustomers";
import { fetchUsersLite, type UserLite } from "../api/usersLite";
import { useToast } from "../components/ui/toast";
import { useMe } from "../contexts/MeContext";
import {
  NewGenButton,
  ClearButton,
  LeftButton,
  RightButton,
  SaveButton,
  CancelButton,
  Search, 
  SearchCode, 
  PlusCircle, 
  SlidersHorizontal,
} from "../components/ui/IconButton";
import SelectField from "../components/ui/SelectField";
import MultiSelectCombobox, {
  type MultiSelectComboboxOption,
} from "../components/ui/MultiSelectCombobox";

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function stripHtml(html?: string | null) {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(text?: string | null, max = 140) {
  const clean = stripHtml(text);
  if (!clean) return "No description";
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}…`;
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

const OPEN_HUNT_STATUSES = new Set(["to_do", "in_progress"]);

const huntStatusOptions: MultiSelectComboboxOption[] = [
  { value: "to_do", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "abandoned", label: "Abandoned" },
];

export default function HuntsPage() {
  const navigate = useNavigate();
  const { push } = useToast();
  const me = useMe();
  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canView = can("hunt.view");
  const canCreate = can("hunt.create");

  const [rows, setRows] = useState<HuntListItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [busy, setBusy] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [title, setTitle] = useState("");
  const [customer, setCustomer] = useState("");
  const [ownerId, setOwnerId] = useState("");

  const [loading, setLoading] = useState(false);
  const [serverCount, setServerCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const pageSizeOptions = [12, 24, 48, 92];

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [customerFilter, setCustomerFilter] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, customerFilter, ownerFilter, includeArchived, pageSize]);

  const huntQueryParams = useMemo(
    () => ({
      page,
      page_size: pageSize,
      search: search || undefined,
      status: statusFilter,
      customer: customerFilter,
      owner: ownerFilter,
      include_archived: includeArchived ? "true" : undefined,
      ordering: "-updated_at",
    }),
    [
      page,
      pageSize,
      search,
      statusFilter,
      customerFilter,
      ownerFilter,
      includeArchived,
    ]
  );

  async function refresh() {
    if (!canView) {
      setRows([]);
      setServerCount(0);
      return;
    }

    setLoading(true);
    try {
      const res = await fetchHunts(huntQueryParams as any);
      setRows(Array.isArray(res?.results) ? res.results : []);
      setServerCount(Number(res?.count ?? 0));
    } catch {
      setRows([]);
      setServerCount(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [huntQueryParams]);

  useEffect(() => {
    listCustomers({ include_inactive: false })
      .then((r) => setCustomers(Array.isArray(r?.results) ? r.results : []))
      .catch(() => setCustomers([]));

    fetchUsersLite()
      .then((payload: any) => setUsers(normalizeUsersLite(payload)))
      .catch(() => setUsers([]));
  }, []);

  const customerOptions = [
    { value: "", label: "— Customer" },
    ...customers.map((c) => ({
      value: String(c.id),
      label: c.name,
    })),
  ];

  const ownerOptions = [
    { value: "", label: "— Owner" },
    ...users.map((u) => ({
      value: String(u.id),
      label: u.username,
    })),
  ];

  const customerDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
    () =>
      customers
        .slice()
        .sort((a, b) => (a?.name || "").localeCompare(b?.name || ""))
        .map((c) => ({
          value: String(c.id),
          label: c.name,
        })),
    [customers]
  );

  const ownerDropdownOptions = useMemo<MultiSelectComboboxOption[]>(
    () =>
      users
        .slice()
        .sort((a, b) => (a?.username || "").localeCompare(b?.username || ""))
        .map((u) => ({
          value: String(u.id),
          label: u.username,
        })),
    [users]
  );

  const filteredRows = rows;
  const totalPages = Math.max(1, Math.ceil(serverCount / pageSize));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setStatusFilter([]);
    setCustomerFilter([]);
    setOwnerFilter([]);
    setIncludeArchived(false);
  };

  function resetCreateForm() {
    setTitle("");
    setCustomer("");
    setOwnerId("");
  }

  function openCreateModal() {
    if (!canCreate) return;
    resetCreateForm();
    setShowCreateModal(true);
  }

  function closeCreateModal() {
    if (busy) return;
    setShowCreateModal(false);
    resetCreateForm();
  }

  async function handleCreateHunt() {
    if (!canCreate || !title.trim()) return;
    setBusy(true);
    try {
      const res = await createHunt({
        title: title.trim(),
        status: "to_do",
        verdict: "unknown",
        customer: customer || null,
        owner_id: ownerId ? Number(ownerId) : null,
      } as any);
      push({ kind: "success", title: "Hunt created" });
      setShowCreateModal(false);
      resetCreateForm();
      navigate(`/hunts/${res.id}`);
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-3xl font-semibold tracking-tight text-foreground">
            Hunts
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Investigation workspaces and proactive research activity
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">

          <NewGenButton
            type="button"
            onClick={openCreateModal}
            disabled={busy || !canCreate}
            iconOnly={false}
            label="New hunt"
            title="Create hunt"
          />
        </div>
      </div>

      {showCreateModal
        ? createPortal(
            <div className="fixed inset-0 z-[110]">
              <button
                type="button"
                className="absolute inset-0 z-0 m-0 h-full w-full cursor-default appearance-none rounded-none border-0 bg-black/40 p-0 outline-none backdrop-blur-[2px]"
                onClick={closeCreateModal}
                aria-label="Close hunt modal"
                disabled={busy}
              />

              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
                <div className="pointer-events-auto flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl">
                  <div className="border-b border-border px-5 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-center gap-2">
                        <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground">
                          <PlusCircle className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="text-lg font-semibold text-foreground">
                            New hunt
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            Create a new investigation workspace
                          </div>
                        </div>
                      </div>

                      <CancelButton
                        type="button"
                        onClick={closeCreateModal}
                        disabled={busy}
                        title="Cancel"
                      />
                    </div>
                  </div>

                  <div className="overflow-y-auto px-5 py-5">
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      <div className="xl:col-span-2">
                        <FieldLabel>Title</FieldLabel>
                        <input
                          className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                          placeholder="Hunt title"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          disabled={busy}
                          autoFocus
                        />
                      </div>

                      <SelectField
                        label="Customer"
                        value={customer}
                        onChange={setCustomer}
                        options={customerOptions}
                        widthClass="w-full"
                      />

                      <SelectField
                        label="Owner"
                        value={ownerId}
                        onChange={setOwnerId}
                        options={ownerOptions}
                        widthClass="w-full"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
                    <div />

                    <SaveButton
                      type="button"
                      onClick={() => void handleCreateHunt()}
                      disabled={busy || !canCreate || !title.trim()}
                      iconOnly={true}
                      label={busy ? "Creating…" : "Create"}
                      title="Create hunt"
                    >
                      {busy ? "Creating…" : "Create"}
                    </SaveButton>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      <Card className="relative z-20 overflow-visible p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div>
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
                    className="h-10 w-full rounded-2xl border border-border bg-card pl-10 pr-3 text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                    placeholder="Title, context"
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
                    onChange={(e) => setIncludeArchived(e.target.checked)}
                  />
                  <span>Include archived hunts</span>
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

            <div className="relative z-30 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <div className="min-w-0 text-xs">
                <MultiSelectCombobox
                  label="Status"
                  options={huntStatusOptions}
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v)}
                  placeholder="-"
                  widthClass="w-full"
                />
              </div>

              <div className="min-w-0 text-xs">
                <MultiSelectCombobox
                  label="Customer"
                  options={customerDropdownOptions}
                  value={customerFilter}
                  onChange={(v) => setCustomerFilter(v)}
                  placeholder="-"
                  widthClass="w-full"
                />
              </div>

              <div className="min-w-0 text-xs">
                <MultiSelectCombobox
                  label="Owner"
                  options={ownerDropdownOptions}
                  value={ownerFilter}
                  onChange={(v) => setOwnerFilter(v)}
                  placeholder="-"
                  widthClass="w-full"
                />
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-lg font-semibold text-foreground">
          Hunt library
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground">
            {serverCount} hunt{serverCount > 1 ? "s" : ""}
          </span>

          <span className="text-xs text-muted-foreground">
            Page {page} / {totalPages}
          </span>

          <div className="flex items-center gap-1">
            <LeftButton
              disabled={loading || page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              title="Previous"
            />
            <RightButton
              disabled={loading || page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              title="Next"
            />
          </div>

          <select
            value={pageSize}
            onChange={(e) => {
              setPage(1);
              setPageSize(Number(e.target.value));
            }}
            disabled={loading}
            className="h-9 rounded-xl border border-border bg-background px-2 text-xs text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-60"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card
              key={i}
              className="min-h-[220px] animate-pulse p-5"
            >
              <div className="h-5 w-32 rounded bg-muted" />
              <div className="mt-4 h-4 w-full rounded bg-muted" />
              <div className="mt-2 h-4 w-5/6 rounded bg-muted" />
              <div className="mt-8 space-y-2">
                <div className="h-3 w-full rounded bg-muted" />
                <div className="h-3 w-full rounded bg-muted" />
                <div className="h-3 w-full rounded bg-muted" />
              </div>
            </Card>
          ))}
        </div>
      ) : filteredRows.length === 0 ? (
        <Card className="border-dashed p-8">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground">
              <SearchCode className="h-5 w-5" />
            </div>
            <div className="mt-4 text-lg font-semibold text-foreground">
              No hunt found
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Try adjusting filters or create a new hunt.
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filteredRows.map((row) => (
            <Link key={row.id} to={`/hunts/${row.id}`} className="group block">
              <Card className="relative flex min-h-[220px] flex-col overflow-hidden p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-panel">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-primary/70 to-transparent" />

                <div className="flex items-start justify-between gap-3 pt-1">
                  <div className="min-w-0">
                    {row.archived_at ? (
                      <div className="mb-2 inline-flex rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Archived
                      </div>
                    ) : null}

                    <div className="line-clamp-2 text-base font-semibold leading-6 text-foreground">
                      {row.title}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <StatusBadge status={row.status as any} />
                  </div>
                </div>

                <div className="mt-4 text-sm leading-6 text-muted-foreground">
                  {truncate(row.context, 50)}
                </div>

                <div className="mt-auto pt-5">
                  <div className="grid gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <span>Created</span>
                      <span className="truncate font-medium text-foreground">
                        {formatDate(row.created_at)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <span>Customer</span>
                      <span className="truncate font-medium text-foreground">
                        {row.customer_name || "All"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <span>Owner</span>
                      <span className="truncate font-medium text-foreground">
                        {row.owner_username || "Unassigned"}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}