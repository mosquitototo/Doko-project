import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useMe } from "../contexts/MeContext";
import Card from "../components/ui/Card";
import MarkdownEditor from "../components/ui/MarkdownEditor";
import { createTicket } from "../api/cases";
import { listCustomers, type Customer } from "../api/settingsCustomers";
import {
  listSeverities,
  listClassifications,
  type SeverityItem,
  type ClassificationItem,
} from "../api/dataModels";
import { fetchUsersLite, type UserLite } from "../api/usersLite";
import {
  CancelButton,
  SaveButton,
} from "../components/ui/IconButton";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </label>
  );
}

export default function TicketNew() {
  const navigate = useNavigate();
  const me = useMe();
  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canAddCase = can("case.add");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [customerId, setCustomerId] = useState<string>("");
  const [severity, setSeverity] = useState<string>("");
  const [classification, setClassification] = useState<string>("");
  const [ownerId, setOwnerId] = useState<string>("");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sevOptions, setSevOptions] = useState<SeverityItem[]>([]);
  const [clsOptions, setClsOptions] = useState<ClassificationItem[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);

  useEffect(() => {
    listCustomers({ include_inactive: false })
      .then((r: any) =>
        setCustomers((r?.results ?? []).filter((c: any) => !!c?.is_active))
      )
      .catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    Promise.all([listSeverities(false), listClassifications(false)])
      .then(([s, c]: any) => {
        setSevOptions((s ?? []).filter((x: any) => !!x?.is_active));
        setClsOptions((c ?? []).filter((x: any) => !!x?.is_active));
      })
      .catch(() => {
        setSevOptions([]);
        setClsOptions([]);
      });
  }, []);

  useEffect(() => {
    fetchUsersLite().then(setUsers).catch(() => setUsers([]));
  }, []);


  const customersArr = useMemo(
    () => (Array.isArray(customers) ? customers : []),
    [customers]
  );
  const usersArr = useMemo(
    () => (Array.isArray(users) ? users : []),
    [users]
  );
  const sevArr = useMemo(
    () => (Array.isArray(sevOptions) ? sevOptions : []),
    [sevOptions]
  );
  const clsArr = useMemo(
    () => (Array.isArray(clsOptions) ? clsOptions : []),
    [clsOptions]
  );

  async function onSubmit(e: React.FormEvent) {
    if (!canAddCase) return;
    e.preventDefault();
    setError(null);

    const t = title.trim();
    if (!t) {
      setError("Title is mandatory.");
      return;
    }

    setBusy(true);
    try {
      const created = await createTicket({
        title: t,
        description,
        customer: customerId || null,
        severity: severity || undefined,
        classification: classification || undefined,
        owner_id: me?.is_staff && ownerId ? Number(ownerId) : undefined,
      });

      navigate(`/cases/${created.id}`);
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      setError(
        status ? `API error (${status}) ${JSON.stringify(data)}` : "Network error"
      );
    } finally {
      setBusy(false);
    }
  }

  if (!canAddCase) {
    return (
      <div className="space-y-3">
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          New case
        </div>
        <div className="text-sm text-muted-foreground">Access denied.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-3xl font-semibold tracking-tight text-foreground">
            New case
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Create a new investigation case
          </div>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">

        <Card className="p-5">
          <div className="mb-4">
            <div className="text-sm font-semibold text-foreground">
              Case details
            </div>
            <div className="text-xs text-muted-foreground">
              Main attributes and ownership
            </div>
          </div>

          <div className="grid gap-4">
            <div>
              <FieldLabel>Title</FieldLabel>
              <input
                className="h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Suspicious network activity"
                disabled={busy || !canAddCase}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <FieldLabel>Customer</FieldLabel>
                <select
                  className="h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  disabled={busy || !canAddCase}
                >
                  <option value="">—</option>
                  {customersArr
                    .slice()
                    .sort((a, b) =>
                      (a?.name || "").localeCompare(b?.name || "")
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <FieldLabel>Owner</FieldLabel>
                <select
                  className="h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  disabled={busy || !me?.is_staff}
                >
                  <option value="">— me (default)</option>
                  {usersArr
                    .slice()
                    .sort((a, b) =>
                      (a.username || "").localeCompare(b.username || "")
                    )
                    .map((u) => (
                      <option key={u.id} value={String(u.id)}>
                        {u.username}
                      </option>
                    ))}
                </select>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {me?.is_staff
                    ? "If empty, backend will set owner to the current user."
                    : "Only staff can assign another owner. If empty, backend will set owner to the current user."}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <FieldLabel>Classification</FieldLabel>
                <select
                  className="h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                  value={classification}
                  onChange={(e) => setClassification(e.target.value)}
                  disabled={busy || !canAddCase}
                >
                  <option value="">—</option>
                  {clsArr
                    .slice()
                    .sort((a, b) =>
                      (a.label || "").localeCompare(b.label || "")
                    )
                    .map((c) => (
                      <option key={c.id} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <FieldLabel>Severity</FieldLabel>
                <select
                  className="h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  disabled={busy || !canAddCase}
                >
                  <option value="">—</option>
                  {sevArr
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
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4">
            <div className="text-sm font-semibold text-foreground">
              Description
            </div>
            <div className="text-xs text-muted-foreground">
              Initial context and investigation scope
            </div>
          </div>

          <MarkdownEditor
            value={description}
            onChange={setDescription}
            disabled={busy || !canAddCase}
            placeholder="Describe the case context, scope and first findings..."
            className="text-sm"
          />
        </Card>

        {error ? (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <CancelButton
            type="button"
            onClick={() => navigate("/cases")}
            disabled={busy}
            title="Cancel"
          />

          <SaveButton
            type="submit"
            disabled={busy || !canAddCase}
            title="Create case"
            aria-label="Create case"
          >
            {busy ? "Creating…" : "Create case"}
          </SaveButton>
        </div>
      </form>
    </div>
  );
}