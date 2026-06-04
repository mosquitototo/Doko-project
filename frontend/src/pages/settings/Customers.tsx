import { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import ConfirmDialogWide from "../../components/ui/ConfirmDialogWide";
import { useToast } from "../../components/ui/toast";
import { useMe } from "../../contexts/MeContext";
import {
  listCustomers,
  createCustomer,
  updateCustomer,
  disableCustomer,
  listCustomerContacts,
  createCustomerContact,
  updateCustomerContact,
  disableCustomerContact,
  type Customer,
  type CustomerContact,
  type CustomerSlaRules,
  type CustomerSlaUnit,
} from "../../api/settingsCustomers";
import { listSeverities, type SeverityItem } from "../../api/dataModels";
import {
  EditGenButton,
  PowerOnButton,
  DeleteButton,
  NewCustomerButton,
  NewGenButton,
} from "../../components/ui/IconButton";

function FieldLabel({
  children,
  required = false,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
      {required ? <span className="ml-1 text-red-500">*</span> : null}
    </div>
  );
}

function SectionHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
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

function SettingTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>
) {
  return (
    <textarea
      {...props}
      className={[
        "w-full rounded-2xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none transition",
        "placeholder:text-muted-foreground",
        "focus:border-ring focus:ring-2 focus:ring-ring/20",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "resize-y",
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

function SettingCheckbox({
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3">
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer rounded border-border"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        {hint ? (
          <div className="text-xs text-muted-foreground">{hint}</div>
        ) : null}
      </div>
    </label>
  );
}


const SLA_UNITS: { value: CustomerSlaUnit; label: string }[] = [
  { value: "minute", label: "Minutes" },
  { value: "hour", label: "Hours" },
  { value: "day", label: "Days" },
  { value: "week", label: "Weeks" },
  { value: "month", label: "Months" },
];

function normalizeSlaRules(input: any): CustomerSlaRules {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const out: CustomerSlaRules = {};

  for (const [code, rule] of Object.entries(input)) {
    if (!code || !rule || typeof rule !== "object" || Array.isArray(rule)) {
      continue;
    }

    const value = Number((rule as any).value || 0);
    const unit = String((rule as any).unit || "");

    if (
      Number.isFinite(value) &&
      value > 0 &&
      ["minute", "hour", "day", "week", "month"].includes(unit)
    ) {
      out[code] = {
        enabled: true,
        value,
        unit: unit as CustomerSlaUnit,
      };
    }
  }

  return out;
}

function updateSlaRule(
  rules: CustomerSlaRules | undefined,
  severityCode: string,
  patch: Partial<{
    enabled: boolean;
    value: number;
    unit: CustomerSlaUnit;
  }>
): CustomerSlaRules {
  const current = normalizeSlaRules(rules);
  const existing = current[severityCode] ?? {
    enabled: true,
    value: 1,
    unit: "hour" as CustomerSlaUnit,
  };

  const next = {
    ...existing,
    ...patch,
  };

  if (!next.enabled) {
    const copy = { ...current };
    delete copy[severityCode];
    return copy;
  }

  return {
    ...current,
    [severityCode]: {
      enabled: true,
      value: Math.max(1, Number(next.value || 1)),
      unit: next.unit ?? "hour",
    },
  };
}


function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        active
          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-border bg-muted text-muted-foreground",
      ].join(" ")}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function StatPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

export default function SettingsCustomers() {
  const { push } = useToast();

  const me = useMe();
  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canView =
    can("settings.customers.view") || can("settings.customers.manage");
  const canManage = can("settings.customers.manage");

  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [severities, setSeverities] = useState<SeverityItem[]>([]);

  const [q, setQ] = useState("");
  const [items, setItems] = useState<Customer[]>([]);
  const [count, setCount] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSla, setCreateSla] = useState("");
  const [createSlaRules, setCreateSlaRules] = useState<CustomerSlaRules>({});

  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [disableTarget, setDisableTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [enableTarget, setEnableTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);


  const [editContacts, setEditContacts] = useState<CustomerContact[]>([]);
  const [editContactsLoading, setEditContactsLoading] = useState(false);
  const [editContactsDirty, setEditContactsDirty] = useState(false);

  useEffect(() => {
    listSeverities(false)
      .then((rows) => {
        setSeverities(rows);
      })
      .catch(() => setSeverities([]));
  }, []);

  useEffect(() => {
    if (!editCustomer) return;

    setEditContacts([]);
    setEditContactsDirty(false);
    setEditContactsLoading(true);

    listCustomerContacts(editCustomer.id, includeInactive)
      .then((res) => setEditContacts(res ?? []))
      .catch((e: any) => {
        push({
          kind: "error",
          title: "Error",
          message: String(e?.response?.status ?? "network"),
        });
        setEditContacts([]);
      })
      .finally(() => setEditContactsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCustomer?.id]);

  async function load() {
    if (!canView) return;
    setLoading(true);
    try {
      const res = await listCustomers({
        q,
        include_inactive: includeInactive,
      });

      setItems(res.results ?? []);
      setCount(res.count ?? (res.results?.length ?? 0));
    } catch (e: any) {
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
    if (!canView) return;

    const t = setTimeout(() => {
      void load();
    }, 250);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, includeInactive, canView]);

  const visible = useMemo(
    () => items.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [items]
  );

  function isValidOptionalEmail(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  }

  function editContactUpdate(index: number, patch: Partial<CustomerContact>) {
    setEditContacts((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c))
    );
    setEditContactsDirty(true);
  }

  function editContactAdd() {
    setEditContacts((prev) => [
      ...prev,
      {
        id: `tmp_${crypto.randomUUID()}`,
        name: "",
        email: "",
        phone: "",
        title: "",
        is_active: true,
      } as any,
    ]);
    setEditContactsDirty(true);
  }

  function editContactRemove(index: number) {
    setEditContacts((prev) => prev.filter((_, i) => i !== index));
    setEditContactsDirty(true);
  }

  if (!canView) {
    return (
      <div className="space-y-3">
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          Customers
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
            Customers
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Manage customer scope, SLA information and operational contacts.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <NewCustomerButton
            title="New customer"
            onClick={() => {
              setCreateOpen(true);
              setCreateName("");
              setCreateSla("");
              setCreateSlaRules({});
            }}
            disabled={loading || !canManage}
            iconOnly={false}
            label="New customer"
          />
        </div>
      </div>

      <Card className="p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="text-sm font-semibold text-foreground">
              Customer directory
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatPill>{count} total</StatPill>
              <StatPill>
                {items.filter((x) => x.is_active).length} active
              </StatPill>
            </div>
          </div>

          <div className="min-w-0">
            <SettingCheckbox
              checked={includeInactive}
              onChange={setIncludeInactive}
              disabled={loading}
              label="Include inactive"
              hint="Show disabled customers in the list."
            />
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)] lg:items-end">
          <label className="space-y-2">
            <FieldLabel>Search</FieldLabel>
            <SettingInput
              placeholder="Search a customer..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              disabled={loading}
            />
          </label>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-16 w-full animate-pulse rounded-2xl bg-muted"
              />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="text-lg font-semibold text-foreground">Empty</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Create customers to scope access and reporting.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-12 gap-3 border-b border-border bg-background/70 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <div className="col-span-3">Name</div>
                <div className="col-span-4">SLA</div>
                <div className="col-span-3">ID</div>
                <div className="col-span-1">Status</div>
                <div className="col-span-1 text-right">Actions</div>
              </div>

              <div className="divide-y divide-border">
                {visible.map((c) => (
                  <div
                    key={c.id}
                    className="grid grid-cols-12 items-center gap-3 px-5 py-4 transition hover:bg-accent/30"
                  >
                    <div className="col-span-3 min-w-0">
                      <div
                        className="truncate text-sm font-medium text-foreground"
                        title={c.name}
                      >
                        {c.name}
                      </div>
                    </div>

                    <div className="col-span-4 min-w-0">
                      <div
                        className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground"
                        title={c.sla}
                      >
                        {c.sla}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {Object.entries(normalizeSlaRules((c as any).sla_rules))
                          .slice(0, 4)
                          .map(([code, rule]) => (
                            <span
                              key={code}
                              className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                            >
                              {code}: {rule.value} {rule.unit}
                            </span>
                          ))}
                      </div>
                    </div>

                    <div className="col-span-3 min-w-0">
                      <div
                        className="truncate font-mono text-xs text-muted-foreground"
                        title={c.id}
                      >
                        {c.id}
                      </div>
                    </div>

                    <div className="col-span-1">
                      <StatusPill active={!!c.is_active} />
                    </div>

                    <div className="col-span-1 flex justify-end gap-2">
                      {canManage ? (
                        <>
                          <EditGenButton
                            onClick={() => setEditCustomer(c)}
                            disabled={loading}
                            title="Edit customer"
                          />
                          {c.is_active ? (
                            <DeleteButton
                              onClick={() =>
                                setDisableTarget({ id: c.id, name: c.name })
                              }
                              disabled={loading}
                              title="Disable customer"
                            />
                          ) : (
                            <PowerOnButton
                              onClick={() =>
                                setEnableTarget({ id: c.id, name: c.name })
                              }
                              disabled={loading}
                              title="Re-enable customer"
                            />
                          )}
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      <ConfirmDialogWide
        open={createOpen}
        title="Create customer"
        confirmText="Create"
        confirmTag="save"
        cancelTag="cancel"
        onCancel={() => setCreateOpen(false)}
        onConfirm={async () => {
          if (!canManage || loading) return;
          const name = createName.trim();
          if (!name) {
            push({
              kind: "error",
              title: "Missing fields",
              message: "name is required",
            });
            return;
          }
          setLoading(true);
          try {
            await createCustomer({ name, sla: createSla, sla_rules: normalizeSlaRules(createSlaRules) });
            push({ kind: "success", title: "Created" });
            setCreateOpen(false);
            setCreateSlaRules({});
            await load();
          } catch (e: any) {
            push({
              kind: "error",
              title: "Error",
              message: String(
                e?.response?.data?.detail ?? e?.response?.status ?? "network"
              ),
            });
          } finally {
            setLoading(false);
          }
        }}
        message={
          <div className="space-y-4">
            <label className="block space-y-2">
              <FieldLabel required>Name</FieldLabel>
              <SettingInput
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Customer name"
              />
            </label>

            <div className="space-y-4 lg:col-span-2">
              <label className="block space-y-2">
                <FieldLabel>SLA notes</FieldLabel>
                <SettingTextarea
                  rows={3}
                  value={createSla}
                  onChange={(e) => setCreateSla(e.target.value)}
                />
                <SectionHint>
                  Optional notes about response time, escalation and scope.
                </SectionHint>
              </label>

              <div className="space-y-3">
                <div>
                  <FieldLabel>SLA by severity</FieldLabel>
                  <SectionHint>
                    Define operational SLA durations for each active severity.
                  </SectionHint>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  {severities.map((sev) => {
                    const code = String(sev.code);
                    const rule = normalizeSlaRules(createSlaRules)[code];

                    return (
                      <Card key={code} className="p-4">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-foreground">
                              {sev.label || code}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {code}
                            </div>
                          </div>

                          <SettingCheckbox
                            checked={!!rule}
                            disabled={loading}
                            label={rule ? "Enabled" : "Disabled"}
                            onChange={(checked) =>
                              setCreateSlaRules((prev) =>
                                updateSlaRule(prev, code, { enabled: checked })
                              )
                            }
                          />
                        </div>

                        {rule ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="block space-y-2">
                              <FieldLabel>Duration</FieldLabel>
                              <SettingInput
                                type="number"
                                min={1}
                                value={rule.value ?? 1}
                                onChange={(e) =>
                                  setCreateSlaRules((prev) =>
                                    updateSlaRule(prev, code, {
                                      value: Number(e.target.value || 1),
                                    })
                                  )
                                }
                              />
                            </label>

                            <label className="block space-y-2">
                              <FieldLabel>Unit</FieldLabel>
                              <SettingSelect
                                value={rule.unit ?? "hour"}
                                onChange={(e) =>
                                  setCreateSlaRules((prev) =>
                                    updateSlaRule(prev, code, {
                                      unit: e.target.value as CustomerSlaUnit,
                                    })
                                  )
                                }
                              >
                                {SLA_UNITS.map((u) => (
                                  <option key={u.value} value={u.value}>
                                    {u.label}
                                  </option>
                                ))}
                              </SettingSelect>
                            </label>
                          </div>
                        ) : null}
                      </Card>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        }
      />

      <ConfirmDialogWide
        open={!!editCustomer}
        title="Edit customer"
        confirmText="Save"
        confirmTag="save"
        cancelTag="cancel"
        onCancel={() => {
          if (loading) return;
          setEditCustomer(null);
          setEditContacts([]);
          setEditContactsDirty(false);
        }}
        onConfirm={async () => {
          if (!editCustomer || !canManage || loading) return;

          const name = editCustomer.name.trim();
          if (!name) {
            push({
              kind: "error",
              title: "Missing fields",
              message: "name is required",
            });
            return;
          }

          const invalidContact = editContacts.find(
            (c) => !isValidOptionalEmail(c.email ?? "")
          );

          if (invalidContact) {
            push({
              kind: "error",
              title: "Invalid contact email",
              message: "Contact email must be valid or left empty.",
            });
            return;
          }

          const incompleteContact = editContacts.find((c) => {
            const hasAnyValue =
              (c.name ?? "").trim() ||
              (c.email ?? "").trim() ||
              (c.phone ?? "").trim() ||
              (c.title ?? "").trim();

            return hasAnyValue && !(c.name ?? "").trim();
          });

          if (incompleteContact) {
            push({
              kind: "error",
              title: "Missing contact name",
              message: "Every filled contact must have a name.",
            });
            return;
          }

          setLoading(true);
          try {
            await updateCustomer(editCustomer.id, {
              name,
              sla: editCustomer.sla ?? "",
              sla_rules: normalizeSlaRules((editCustomer as any).sla_rules),
            });

            const existing = await listCustomerContacts(editCustomer.id, true);
            const existingById = new Map(
              (existing ?? []).map((c: any) => [String(c.id), c])
            );

            for (const c of editContacts) {
              const cid = String((c as any).id ?? "");
              const payload = {
                name: (c.name ?? "").trim(),
                email: (c.email ?? "").trim() || undefined,
                phone: (c.phone ?? "").trim() || undefined,
                title: (c.title ?? "").trim() || undefined,
                is_active: (c as any).is_active ?? true,
              };

              if (!payload.name) continue;

              if (existingById.has(cid) && !cid.startsWith("tmp_")) {
                await updateCustomerContact(cid, payload as any);
                existingById.delete(cid);
              } else {
                await createCustomerContact(editCustomer.id, payload as any);
              }
            }

            for (const [id] of existingById) {
              await disableCustomerContact(String(id));
            }

            push({ kind: "success", title: "Updated" });
            setEditCustomer(null);
            setEditContacts([]);
            setEditContactsDirty(false);

            await load();
          } catch (e: any) {
            push({
              kind: "error",
              title: "Error",
              message: String(
                e?.response?.data?.detail ?? e?.response?.status ?? "network"
              ),
            });
          } finally {
            setLoading(false);
          }
        }}
        message={
          editCustomer ? (
            <div className="space-y-5">
              <Card className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="text-sm font-semibold text-foreground">
                    Customer
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Edit customer details
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="block space-y-2">
                    <FieldLabel required>Name</FieldLabel>
                    <SettingInput
                      value={editCustomer.name}
                      onChange={(e) =>
                        setEditCustomer({
                          ...editCustomer,
                          name: e.target.value,
                        })
                      }
                    />
                  </label>


                </div>

                <div className="space-y-4">
                  <label className="block space-y-2">
                    <FieldLabel>SLA notes</FieldLabel>
                    <SettingTextarea
                      rows={4}
                      value={editCustomer.sla ?? ""}
                      onChange={(e) =>
                        setEditCustomer({
                          ...editCustomer,
                          sla: e.target.value,
                        })
                      }
                    />
                    <SectionHint>
                      Notes about response time, escalation and scope.
                    </SectionHint>
                  </label>

                  <div className="space-y-3">
                    <div>
                      <FieldLabel>SLA by severity</FieldLabel>
                      <SectionHint>
                        Define operational SLA durations for each active severity.
                      </SectionHint>
                    </div>

                    <div className="grid gap-3">
                      {severities.map((sev) => {
                        const code = String(sev.code);
                        const rules = normalizeSlaRules((editCustomer as any).sla_rules);
                        const rule = rules[code];

                        return (
                          <Card key={code} className="p-4">
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-foreground">
                                  {sev.label || code}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {code}
                                </div>
                              </div>

                              <SettingCheckbox
                                checked={!!rule}
                                disabled={loading}
                                label={rule ? "Enabled" : "Disabled"}
                                onChange={(checked) =>
                                  setEditCustomer({
                                    ...editCustomer,
                                    sla_rules: updateSlaRule(rules, code, {
                                      enabled: checked,
                                    }),
                                  } as any)
                                }
                              />
                            </div>

                            {rule ? (
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="block space-y-2">
                                  <FieldLabel>Duration</FieldLabel>
                                  <SettingInput
                                    type="number"
                                    min={1}
                                    value={rule.value ?? 1}
                                    onChange={(e) =>
                                      setEditCustomer({
                                        ...editCustomer,
                                        sla_rules: updateSlaRule(rules, code, {
                                          value: Number(e.target.value || 1),
                                        }),
                                      } as any)
                                    }
                                  />
                                </label>

                                <label className="block space-y-2">
                                  <FieldLabel>Unit</FieldLabel>
                                  <SettingSelect
                                    value={rule.unit ?? "hour"}
                                    onChange={(e) =>
                                      setEditCustomer({
                                        ...editCustomer,
                                        sla_rules: updateSlaRule(rules, code, {
                                          unit: e.target.value as CustomerSlaUnit,
                                        }),
                                      } as any)
                                    }
                                  >
                                    {SLA_UNITS.map((u) => (
                                      <option key={u.value} value={u.value}>
                                        {u.label}
                                      </option>
                                    ))}
                                  </SettingSelect>
                                </label>
                              </div>
                            ) : null}
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      Contacts
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Manage operational contacts for this customer.
                    </div>
                  </div>

                  <NewGenButton
                    title="Add contact"
                    onClick={editContactAdd}
                    disabled={loading || editContactsLoading}
                    iconOnly={false}
                    label="Add contact"
                  />
                </div>

                {editContactsLoading ? (
                  <div className="rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                    Loading contacts…
                  </div>
                ) : editContacts.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                    No contacts yet. Add one using the button above.
                  </div>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {editContacts.map((ct: any, i) => (
                      <Card key={String(ct.id) || i} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-foreground">
                              {ct.name?.trim() ? ct.name : "New contact"}
                            </div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">
                              {ct.title?.trim() ? ct.title : "—"}
                            </div>
                          </div>

                          <DeleteButton
                            title="Delete"
                            onClick={() => editContactRemove(i)}
                            disabled={loading || editContactsLoading}
                          />
                        </div>

                        <div className="mt-4 grid gap-4">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <label className="block space-y-2">
                              <FieldLabel required>Name</FieldLabel>
                              <SettingInput
                                placeholder="Name"
                                value={ct.name ?? ""}
                                onChange={(e) =>
                                  editContactUpdate(i, {
                                    name: e.target.value,
                                  } as any)
                                }
                              />
                            </label>

                            <label className="block space-y-2">
                              <FieldLabel>Title</FieldLabel>
                              <SettingInput
                                placeholder="IT manager"
                                value={ct.title ?? ""}
                                onChange={(e) =>
                                  editContactUpdate(i, {
                                    title: e.target.value,
                                  } as any)
                                }
                              />
                            </label>
                          </div>

                          <div className="grid gap-4 lg:grid-cols-2">
                            <label className="block space-y-2">
                              <FieldLabel>Email</FieldLabel>
                              <SettingInput
                                placeholder="name@company.tld"
                                value={ct.email ?? ""}
                                onChange={(e) =>
                                  editContactUpdate(i, {
                                    email: e.target.value,
                                  } as any)
                                }
                              />
                            </label>

                            <label className="block space-y-2">
                              <FieldLabel>Phone</FieldLabel>
                              <SettingInput
                                placeholder="+33 …"
                                value={ct.phone ?? ""}
                                onChange={(e) =>
                                  editContactUpdate(i, {
                                    phone: e.target.value,
                                  } as any)
                                }
                              />
                            </label>
                          </div>

                          <SettingCheckbox
                            checked={ct.is_active ?? true}
                            onChange={(next) =>
                              editContactUpdate(i, { is_active: next } as any)
                            }
                            label="Contact enabled"
                            hint="Disabled contacts remain stored but inactive."
                          />
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          ) : null
        }
      />

      <ConfirmDialog
        open={!!disableTarget}
        title="Disable customer"
        confirmText="Disable"
        confirmTag="delete"
        cancelTag="cancel"
        onCancel={() => {
          if (loading) return;
          setDisableTarget(null);
        }}
        onConfirm={async () => {
          if (!disableTarget || !canManage || loading) return;

          setLoading(true);
          try {
            await disableCustomer(disableTarget.id);
            push({ kind: "success", title: "Customer disabled" });
            setDisableTarget(null);
            await load();
          } catch (e: any) {
            push({
              kind: "error",
              title: "Error",
              message: String(
                e?.response?.data?.detail ?? e?.response?.status ?? "network"
              ),
            });
          } finally {
            setLoading(false);
          }
        }}
        message={
          disableTarget ? (
            <div className="space-y-2">
              <div className="text-sm text-foreground">
                Disable customer <b>{disableTarget.name}</b>?
              </div>
              <div className="text-xs text-muted-foreground">
                This is a soft-delete: the customer becomes inactive.
              </div>
            </div>
          ) : null
        }
      />

      <ConfirmDialog
        open={!!enableTarget}
        title="Re-enable customer"
        confirmText="Enable"
        confirmTag="save"
        cancelTag="cancel"
        onCancel={() => {
          if (loading) return;
          setEnableTarget(null);
        }}
        onConfirm={async () => {
          if (!enableTarget || !canManage || loading) return;

          setLoading(true);
          try {
            await updateCustomer(enableTarget.id, { is_active: true });
            push({ kind: "success", title: "Customer re-enabled" });
            setEnableTarget(null);
            await load();
          } catch (e: any) {
            push({
              kind: "error",
              title: "Error",
              message: String(
                e?.response?.data?.detail ?? e?.response?.status ?? "network"
              ),
            });
          } finally {
            setLoading(false);
          }
        }}
        message={
          enableTarget ? (
            <div className="text-sm text-foreground">
              Re-enable customer <b>{enableTarget.name}</b>?
            </div>
          ) : null
        }
      />
    </div>
  );
}