import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import Card from "../../../components/ui/Card";
import { useToast } from "../../../components/ui/toast";
import { useMe } from "../../../contexts/MeContext";
import {
  listPermissions,
  listRoles,
  updateRole,
  createRole,
  getRoleCustomerAccess,
  putRoleCustomerAccess,
  type PermissionItem,
  type RoleItem,
} from "../../../api/settingsRoles";
import { listCustomers, type Customer } from "../../../api/settingsCustomers";
import { SaveButton, LeftButton } from "../../../components/ui/IconButton";

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

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

function StatPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function permIdsByCode(permissions: PermissionItem[]) {
  const m = new Map<string, number>();
  for (const p of permissions) m.set(p.code, p.id);
  return m;
}

function categoryFromCode(code: string): string {
  const parts = (code || "").split(".");
  const a = parts[0] || "";

  if (a === "case") return "Cases";
  if (a === "alert") return "Alerts";
  if (a === "hunt") return "Hunts";
  if (a === "task") return "Tasks";
  if (a === "chat") return "Chatbot";

  if (a === "settings") {
    const b = parts[1] || "";
    const c = parts[2] || "";

    if (b === "access" && c === "users") return "Users";
    if (b === "access" && c === "roles") return "Roles";

    if (b === "data_models") return "Data models";
    if (b === "reports") return "Reports";
    if (b === "customers") return "Customers";
    if (b === "workbooks") return "Workbooks";
    if (b === "connectors") return "Connectors";
    if (b === "case_management") return "Case management";
    if (b === "aisoar") return "AI & SOAR";
    if (b === "automation_rules") return "Automation rules";
    if (b === "documentation") return "Documentation";
    if (b === "audit") return "Audit";

    return "Settings";
  }

  return a ? a.charAt(0).toUpperCase() + a.slice(1) : "Other";
}

function groupPermissions(perms: PermissionItem[]) {
  const m = new Map<string, PermissionItem[]>();
  for (const p of perms) {
    const cat = categoryFromCode(p.code);
    const arr = m.get(cat) ?? [];
    arr.push(p);
    m.set(cat, arr);
  }

  return Array.from(m.entries())
    .map(
      ([cat, arr]) =>
        [cat, arr.slice().sort((x, y) => (x.code || "").localeCompare(y.code || ""))] as const
    )
    .sort((a, b) => a[0].localeCompare(b[0]));
}

type PackKey = "view" | "view_edit" | "manage";
type PackDef = { key: string; kind: PackKey; label: string; codes: string[] };

function idsFromCodes(codes: string[], permCodeToId: Map<string, number>) {
  return codes
    .map((c) => permCodeToId.get(c))
    .filter((x): x is number => typeof x === "number");
}

function toSettingsKey(cat: string) {
  if (cat === "Customers") return "customers";
  if (cat === "Reports") return "reports";
  if (cat === "Data models") return "data_models";
  if (cat === "Workbooks") return "workbooks";
  if (cat === "Connectors") return "connectors";
  if (cat === "Case management") return "case_management";
  if (cat === "AI & SOAR") return "aisoar";
  if (cat === "Automation rules") return "automation_rules";
  if (cat === "Documentation") return "documentation";
  if (cat === "Audit") return "audit";
  return "settings";
}

function buildCategoryPacks(cat: string, perms: PermissionItem[]): PackDef[] {
  const codes = new Set(perms.map((p) => p.code));
  const packs: PackDef[] = [];

  const addIfAny = (out: string[], candidates: string[]) => {
    for (const c of candidates) if (codes.has(c)) out.push(c);
  };

  if (cat === "Cases") {
    const view: string[] = [];
    addIfAny(view, ["case.view"]);
    if (view.length > 0) {
      packs.push({ key: "cases_view", kind: "view", label: "View", codes: view });

      const viewEdit = [...view];
      addIfAny(viewEdit, ["case.update"]);
      if (viewEdit.length > view.length) {
        packs.push({
          key: "cases_view_edit",
          kind: "view_edit",
          label: "View & Edit",
          codes: viewEdit,
        });
      }

      packs.push({
        key: "cases_manage",
        kind: "manage",
        label: "Manage",
        codes: perms.map((p) => p.code),
      });
    }
    return packs;
  }

  if (cat === "Alerts") {
    const view: string[] = [];
    addIfAny(view, ["alert.view"]);
    if (view.length > 0) {
      packs.push({ key: "alerts_view", kind: "view", label: "View", codes: view });

      const viewEdit = [...view];
      addIfAny(viewEdit, ["alert.update", "alert.unmerge", "alert.merge", "alert.escalate"]);
      if (viewEdit.length > view.length) {
        packs.push({
          key: "alerts_view_edit",
          kind: "view_edit",
          label: "View & Edit",
          codes: viewEdit,
        });
      }

      packs.push({
        key: "alerts_manage",
        kind: "manage",
        label: "Manage",
        codes: perms.map((p) => p.code),
      });
    }
    return packs;
  }


  if (cat === "Hunts") {
    const view: string[] = [];
    addIfAny(view, ["hunt.view"]);
    if (view.length > 0) {
      packs.push({ key: "hunts_view", kind: "view", label: "View", codes: view });

      const manage: string[] = [];
      addIfAny(manage, ["hunt.create", "hunt.manage"]);

      if (manage.length > 0) {
        packs.push({
          key: "hunts_manage",
          kind: "manage",
          label: "Manage",
          codes: uniq([...view, ...manage]),
        });
      }
    }
    return packs;
  }


  if (cat === "Tasks") {
    const view: string[] = [];
    addIfAny(view, ["task.view"]);
    if (view.length > 0) {
      packs.push({ key: "tasks_view", kind: "view", label: "View", codes: view });

      const manage: string[] = [];
      addIfAny(manage, ["task.add", "task.manage"]);

      if (manage.length > 0) {
        packs.push({
          key: "tasks_manage",
          kind: "manage",
          label: "Manage",
          codes: uniq([...view, ...manage]),
        });
      }
    }
    return packs;
  }


  if (cat === "Chatbot") {
    const use: string[] = [];
    addIfAny(use, ["chat.use"]);

    if (use.length > 0) {
      packs.push({ key: "chatbot_use", kind: "view", label: "Use", codes: use });
    }

    const llm: string[] = [];
    addIfAny(llm, ["chat.use", "chat.llm.use"]);

    if (llm.length > use.length) {
      packs.push({
        key: "chatbot_llm",
        kind: "view_edit",
        label: "LLM",
        codes: uniq(llm),
      });
    }

    const manage: string[] = [];
    addIfAny(manage, perms.map((p) => p.code));

    if (manage.length > 0) {
      packs.push({
        key: "chatbot_manage",
        kind: "manage",
        label: "All chatbot",
        codes: uniq(manage),
      });
    }

    return packs;
  }


  if (cat === "Users") {
    const view: string[] = [];
    addIfAny(view, ["settings.access.users.view"]);
    if (view.length > 0) {
      packs.push({ key: "users_view", kind: "view", label: "View", codes: view });
    }

    const manage: string[] = [];
    addIfAny(manage, ["settings.access.users.view", "settings.access.users.manage", "settings.access.users.delete"]);
    if (manage.length > 0) {
      packs.push({
        key: "users_manage",
        kind: "manage",
        label: "Manage",
        codes: uniq([...view, ...manage]),
      });
    }
    return packs;
  }

  if (cat === "Roles") {
    const view: string[] = [];
    addIfAny(view, ["settings.access.roles.view"]);
    if (view.length > 0) {
      packs.push({ key: "roles_view", kind: "view", label: "View", codes: view });
    }

    const manage: string[] = [];
    addIfAny(manage, ["settings.access.roles.view", "settings.access.roles.manage", "settings.access.roles.delete"]);
    if (manage.length > 0) {
      packs.push({
        key: "roles_manage",
        kind: "manage",
        label: "Manage",
        codes: uniq([...view, ...manage]),
      });
    }
    return packs;
  }

  if (cat === "Automation rules") {
    const view: string[] = [];
    addIfAny(view, ["settings.automation_rules.view"]);
    if (view.length > 0) {
      packs.push({ key: "automationrules_view", kind: "view", label: "View", codes: view });
    }

    const manage: string[] = [];
    addIfAny(manage, ["settings.automation_rules.view", "settings.automation_rules.manage", "settings.automation_rules.delete"]);
    if (manage.length > 0) {
      packs.push({
        key: "automationrules_manage",
        kind: "manage",
        label: "Manage",
        codes: uniq([...manage]),
      });
    }
    return packs;
  }


  if (cat === "Connectors") {
    const view: string[] = [];
    addIfAny(view, ["settings.connectors.view"]);
    if (view.length > 0) {
      packs.push({ key: "connectors_view", kind: "view", label: "View", codes: view });
    }

    const manage: string[] = [];
    addIfAny(manage, ["settings.connectors.view", "settings.connectors.manage", "settings.connectors.delete"]);
    if (manage.length > 0) {
      packs.push({
        key: "connectors_manage",
        kind: "manage",
        label: "Manage",
        codes: uniq([...manage]),
      });
    }
    return packs;
  }


  if (cat === "Customers") {
    const view: string[] = [];
    addIfAny(view, ["settings.customers.view"]);
    if (view.length > 0) {
      packs.push({ key: "customers_view", kind: "view", label: "View", codes: view });
    }

    const manage: string[] = [];
    addIfAny(manage, ["settings.customers.view", "settings.customers.manage", "settings.customers.delete"]);
    if (manage.length > 0) {
      packs.push({
        key: "customers_manage",
        kind: "manage",
        label: "Manage",
        codes: uniq([...manage]),
      });
    }
    return packs;
  }


  if (cat === "Data models") {
    const view: string[] = [];
    addIfAny(view, ["settings.data_models.view"]);
    if (view.length > 0) {
      packs.push({ key: "datamodels_view", kind: "view", label: "View", codes: view });
    }

    const manage: string[] = [];
    addIfAny(manage, ["settings.data_models.view", "settings.data_models.manage", "settings.data_models.delete"]);
    if (manage.length > 0) {
      packs.push({
        key: "datamodels_manage",
        kind: "manage",
        label: "Manage",
        codes: uniq([...manage]),
      });
    }
    return packs;
  }


  if (cat === "Reports") {
    const view: string[] = [];
    addIfAny(view, ["settings.reports.view"]);
    if (view.length > 0) {
      packs.push({ key: "reports_view", kind: "view", label: "View", codes: view });
    }

    const manage: string[] = [];
    addIfAny(manage, ["settings.reports.view", "settings.reports.manage", "settings.reports.delete"]);
    if (manage.length > 0) {
      packs.push({
        key: "reports_manage",
        kind: "manage",
        label: "Manage",
        codes: uniq([...manage]),
      });
    }
    return packs;
  }


  if (cat === "Workbooks") {
    const view: string[] = [];
    addIfAny(view, ["settings.workbooks.view"]);
    if (view.length > 0) {
      packs.push({ key: "workbooks_view", kind: "view", label: "View", codes: view });
    }

    const manage: string[] = [];
    addIfAny(manage, ["settings.workbooks.view", "settings.workbooks.manage", "settings.workbooks.delete"]);
    if (manage.length > 0) {
      packs.push({
        key: "workbooks_manage",
        kind: "manage",
        label: "Manage",
        codes: uniq([...manage]),
      });
    }
    return packs;
  }


  if (cat === "Documentation") {
    const view: string[] = [];
    addIfAny(view, ["settings.documentation.view"]);
    if (view.length > 0) {
      packs.push({ key: "documentation_view", kind: "view", label: "View", codes: view });
    }
    return packs;
  }

  if (cat === "Audit") {
    const view: string[] = [];
    addIfAny(view, ["settings.audit.view"]);
    if (view.length > 0) {
      packs.push({ key: "audit_view", kind: "view", label: "View", codes: view });
    }
    return packs;
  }

  const sk = toSettingsKey(cat);

  const view: string[] = [];
  addIfAny(view, [`settings.${sk}.view`]);
  if (view.length > 0) {
    packs.push({ key: `${cat}_view`, kind: "view", label: "View", codes: view });
  }

  const viewEdit = [...view];
  addIfAny(viewEdit, [`settings.${sk}.edit`, `settings.${sk}.update`]);
  if (view.length > 0 && viewEdit.length > view.length) {
    packs.push({
      key: `${cat}_view_edit`,
      kind: "view_edit",
      label: "View & Edit",
      codes: uniq(viewEdit),
    });
  }

  const manage: string[] = [];
  addIfAny(manage, [`settings.${sk}.manage`]);

  if (manage.length > 0) {
    packs.push({
      key: `${cat}_manage`,
      kind: "manage",
      label: "Manage",
      codes: uniq([...(viewEdit.length ? viewEdit : view), ...manage]),
    });
  } else if (perms.length > 0) {
    packs.push({
      key: `${cat}_manage_all`,
      kind: "manage",
      label: "Manage",
      codes: perms.map((p) => p.code),
    });
  }

  return packs.filter((p) => p.codes.length > 0);
}

export default function RoleEditPage() {
  const { push } = useToast();
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();

  const paramRoleId = (params as any).roleId as string | undefined;
  const isNew = paramRoleId === "new" || location.pathname.endsWith("/new");
  const roleId = isNew ? null : Number(paramRoleId);

  const me = useMe();

  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canView = can("settings.access.roles.view");
  const canManage = can("settings.access.roles.manage");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [role, setRole] = useState<RoleItem | null>(null);

  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const groupedPermissions = useMemo(
    () => groupPermissions(permissions),
    [permissions]
  );
  const permCodeToId = useMemo(() => permIdsByCode(permissions), [permissions]);

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [selectedPermIds, setSelectedPermIds] = useState<number[]>([]);

  const [permSearch, setPermSearch] = useState("");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [roleCustomerIds, setRoleCustomerIds] = useState<string[]>([]);
  const [initialRoleCustomerIds, setInitialRoleCustomerIds] = useState<string[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [includeInactiveCustomers, setIncludeInactiveCustomers] = useState(false);

  const customersArr = useMemo(
    () => (Array.isArray(customers) ? customers : []),
    [customers]
  );

  function togglePerm(id: number) {
    setSelectedPermIds((prev) => {
      const arr = prev || [];
      if (arr.includes(id)) return arr.filter((x) => x !== id);
      return uniq([...arr, id]);
    });
  }

  function setCategoryToCodes(idsInCategory: number[], codes: string[]) {
    const nextIds = idsFromCodes(codes, permCodeToId);
    const removeSet = new Set(idsInCategory);
    setSelectedPermIds((prev) =>
      uniq([...(prev || []).filter((id) => !removeSet.has(id)), ...nextIds])
    );
  }

  function resetCategory(idsInCategory: number[]) {
    const removeSet = new Set(idsInCategory);
    setSelectedPermIds((prev) => (prev || []).filter((id) => !removeSet.has(id)));
  }

  async function load() {
    if (!canView) return;

    if (isNew) {
      setLoading(true);
      try {
        const perms = await listPermissions(permSearch.trim());
        setPermissions(perms);
        setRole(null);
        setName("");
        setDesc("");
        setSelectedPermIds([]);
        setCustomers([]);
        setRoleCustomerIds([]);
      } catch (e: any) {
        push({
          kind: "error",
          title: "Error",
          message: String(e?.response?.status ?? "network"),
        });
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!paramRoleId || roleId === null || Number.isNaN(roleId) || roleId <= 0) {
      push({ kind: "error", title: "Error", message: "Invalid role id" });
      return;
    }

    const currentRoleId = roleId;

    setLoading(true);
    try {
      const permsPromise = listPermissions(permSearch.trim());

      const [roles, perms] = await Promise.all([listRoles(), permsPromise]);
      const r = roles.find((x) => Number(x.id) === currentRoleId) ?? null;

      setRole(r);
      setPermissions(perms);

      if (r) {
        setName(r.name);
        setDesc(r.description || "");
        setSelectedPermIds(r.permissions?.map((p) => p.id) ?? []);
      } else {
        setName("");
        setDesc("");
        setSelectedPermIds([]);
      }

      setLoadingCustomers(true);
      try {
        const [custRes, access] = await Promise.all([
          listCustomers({ include_inactive: true }),
          getRoleCustomerAccess(currentRoleId),
        ]);

        const list = (custRes?.results ?? []).slice();
        list.sort((a: any, b: any) => (a?.name || "").localeCompare(b?.name || ""));
        setCustomers(list);
        const ids = (access?.customer_ids ?? []).map((x: any) => String(x));
        setRoleCustomerIds(ids);
        setInitialRoleCustomerIds(ids);
      } catch {
        setCustomers([]);
        setRoleCustomerIds([]);
      } finally {
        setLoadingCustomers(false);
      }
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
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, paramRoleId, isNew]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!canView) return;
      listPermissions(permSearch.trim())
        .then(setPermissions)
        .catch(() => setPermissions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [permSearch, canView]);

  if (!canView) {
    return (
      <div className="space-y-3">
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          {isNew ? "Create role" : "Edit role"}
        </div>
        <div className="text-sm text-muted-foreground">Access denied.</div>
      </div>
    );
  }

  if (!isNew && !loading && !role) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">

          <div className="flex min-w-0 items-start gap-3">
            <LeftButton
              onClick={() => navigate("/settings/access-control/roles")}
              title="Back"
              iconOnly
            />
            <div className="min-w-0">
              <div className="text-3xl font-semibold tracking-tight text-foreground">
                Edit role
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Role not found.
              </div>
            </div>
          </div>
        </div>

        <Card className="p-5">
          <div className="text-sm text-muted-foreground">Role not found.</div>
        </Card>
      </div>
    );
  }

  const selectedCount = selectedPermIds.length;

  const filteredCustomers = customersArr
    .slice()
    .filter((c: any) => {
      const q = (customerSearch || "").trim().toLowerCase();
      if (!q) return true;
      const matchesName = String(c?.name || "").toLowerCase().includes(q);
      const matchesId = String(c?.id || "").toLowerCase().includes(q);
      return matchesName || matchesId;
    })
    .filter((c: any) => (includeInactiveCustomers ? true : c?.is_active !== false))
    .sort((a: any, b: any) => (a?.name || "").localeCompare(b?.name || ""));

  const roleInfoDirty =
    name !== (role?.name || "") ||
    desc !== (role?.description || "") ||
    JSON.stringify([...selectedPermIds].sort((a, b) => a - b)) !==
      JSON.stringify(
        [...(role?.permissions?.map((p) => p.id) ?? [])].sort((a, b) => a - b)
      );


  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
            <div className="mb-1 flex h-8 items-center">
              <LeftButton
                onClick={() => navigate("/settings/access-control/roles")}
                title="Back"
                iconOnly
                className="px-1 py-1 h-fit min-h-0 line-height-none"
              />
            </div>
          <div className="min-w-0">
            <div className="text-3xl font-semibold tracking-tight text-foreground truncate">
              {isNew ? "Create role" : "Edit role"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {!isNew && role?.name ? (
                <span className="font-mono">Role ID #{role.id}</span>
              ) : (
                "Create a new RBAC role and define its scope."
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SaveButton
            disabled={!canManage || saving || loading}
            onClick={async () => {
              if (!canManage || saving || loading || loadingCustomers) return;

              const n = name.trim();
              if (!n) {
                push({ kind: "error", title: "Missing name" });
                return;
              }

              setSaving(true);
              try {
                if (isNew) {
                  const created = await createRole({
                    name: n,
                    description: desc,
                    permission_ids: selectedPermIds,
                  });

                  if (created?.id && roleCustomerIds.length > 0) {
                    await putRoleCustomerAccess(created.id, roleCustomerIds);
                  }

                  push({ kind: "success", title: "Role created" });
                } else {
                  if (!role) return;

                  await updateRole(role.id, {
                    name: n,
                    description: desc,
                    permission_ids: selectedPermIds,
                  });

                  await putRoleCustomerAccess(role.id, roleCustomerIds);

                  push({ kind: "success", title: "Role updated" });
                }

                navigate("/settings/access-control/roles");
              } catch (e: any) {
                push({
                  kind: "error",
                  title: "Error",
                  message: String(
                    e?.response?.data?.detail ?? e?.response?.status ?? "network"
                  ),
                });
              } finally {
                setSaving(false);
              }
            }}
            title="Save"
            iconOnly={false}
            label={saving ? "Saving..." : "Save"}
          />
        </div>
      </div>

      <Card className="p-5">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">Role info</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Define the role name and general description.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatPill>{selectedCount} permissions selected</StatPill>
            {!isNew && role ? <StatPill>Editing existing role</StatPill> : null}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <label className="block space-y-2 lg:col-span-1">
            <FieldLabel required>Name</FieldLabel>
            <SettingInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canManage || loading || saving}
              placeholder="Role name"
            />
          </label>

          <label className="block space-y-2 lg:col-span-2">
            <FieldLabel>Description</FieldLabel>
            <SettingTextarea
              rows={3}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              disabled={!canManage || loading || saving}
              placeholder="Describe the purpose of this role..."
            />
          </label>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">
              Customer access
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Restrict this role to specific customers.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isNew ? (
              <StatPill>Saved with role</StatPill>
            ) : null}
          </div>
        </div>

        {isNew ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-8 text-sm text-muted-foreground">
            Create the role first to configure customer access.
          </div>
        ) : loadingCustomers ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-12 w-full animate-pulse rounded-2xl bg-muted"
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <label className="block space-y-2">
                  <FieldLabel>Search customers</FieldLabel>
                  <SettingInput
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="Search by name or id..."
                    disabled={loading || saving || loadingCustomers}
                  />
                </label>

                <div className="min-w-0">
                  <SettingCheckbox
                    checked={includeInactiveCustomers}
                    onChange={setIncludeInactiveCustomers}
                    disabled={loading || saving || loadingCustomers}
                    label="Include inactive"
                    hint="Show disabled customers in the list."
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-background overflow-hidden">
                <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Customers
                  </div>
                  <div className="text-[11px] font-mono text-muted-foreground">
                    {roleCustomerIds.length}/{filteredCustomers.length}
                  </div>
                </div>

                <div className="max-h-[320px] overflow-y-auto p-2">
                  {filteredCustomers.length === 0 ? (
                    <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                      No customers.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredCustomers.map((c: any) => {
                        const id = String(c.id);
                        const checked = roleCustomerIds.includes(id);
                        const disabled =
                          !canManage || saving || loading;

                        return (
                          <label
                            key={id}
                            className={[
                              "flex items-start gap-3 rounded-2xl border px-3 py-3 transition",
                              disabled
                                ? "cursor-not-allowed opacity-70 border-border bg-card"
                                : "cursor-pointer border-border bg-card hover:bg-accent/50",
                            ].join(" ")}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setRoleCustomerIds((prev) => {
                                  const arr = prev || [];
                                  if (arr.includes(id)) {
                                    return arr.filter((x) => x !== id);
                                  }
                                  return uniq([...arr, id]);
                                });
                              }}
                              disabled={disabled}
                              className="mt-1 h-4 w-4 rounded border-border"
                            />

                            <div className="min-w-0 flex-1">
                              <div className="break-words text-sm font-medium text-foreground">
                                {c.name || "—"}
                              </div>
                              <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                                {id}
                              </div>
                            </div>

                            {c.is_active === false ? (
                              <StatPill>Inactive</StatPill>
                            ) : null}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 border-t border-border bg-muted/30 px-4 py-3">
                  <button
                    type="button"
                    className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
                    disabled={!canManage || saving || loading}
                    onClick={() =>
                      setRoleCustomerIds(filteredCustomers.map((c: any) => String(c.id)))
                    }
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
                    disabled={!canManage || saving || loading}
                    onClick={() => setRoleCustomerIds([])}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-background p-4">
              <div className="text-sm font-semibold text-foreground">Notes</div>
              <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                <p>
                  Users with this role only access objects for the selected customers.
                </p>
                <p>
                  Permissions below still control what they can do inside that scope.
                </p>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">Permissions</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Assign granular permissions by category.
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[220px_auto] lg:items-end">
            <label className="block space-y-2">
              <FieldLabel>Search permissions</FieldLabel>
              <SettingInput
                value={permSearch}
                onChange={(e) => setPermSearch(e.target.value)}
                placeholder="Search by code or label..."
                disabled={loading || saving}
              />
            </label>

            <div className="flex items-center gap-2">
              <StatPill>{selectedCount} selected</StatPill>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-12 w-full animate-pulse rounded-2xl bg-muted"
              />
            ))}
          </div>
        ) : permissions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
            No permissions found.
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {groupedPermissions.map(([cat, perms]) => {
              const idsInCat = perms.map((p) => p.id);
              const selectedInCat = perms.filter((p) =>
                selectedPermIds.includes(p.id)
              ).length;

              const packs = buildCategoryPacks(cat, perms);
              const packView = packs.find((p) => p.kind === "view");
              const packViewEdit = packs.find((p) => p.kind === "view_edit");
              const packManage = packs.find((p) => p.kind === "manage");

              const disabled = !canManage || loading || saving;

              const isExact = (pack?: PackDef) => {
                if (!pack) return false;
                const ids = idsFromCodes(pack.codes, permCodeToId);
                if (ids.length === 0) return false;

                const selectedSet = new Set(selectedPermIds);
                const catSelected = idsInCat
                  .filter((id) => selectedSet.has(id))
                  .slice()
                  .sort((a, b) => a - b);

                const target = ids.slice().sort((a, b) => a - b);
                if (catSelected.length !== target.length) return false;
                for (let i = 0; i < target.length; i++) {
                  if (catSelected[i] !== target[i]) return false;
                }
                return true;
              };

              return (
                <div
                  key={cat}
                  className="overflow-hidden rounded-2xl border border-border bg-background"
                >
                  <div className="border-b border-border bg-muted/40 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {cat}
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground">
                        {selectedInCat}/{perms.length}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {packView ? (
                        <button
                          type="button"
                          className={[
                            "rounded-xl border px-3 py-2 text-xs font-medium transition disabled:opacity-50",
                            isExact(packView)
                              ? "border-transparent bg-foreground text-background"
                              : "border-border bg-card text-foreground hover:bg-accent",
                          ].join(" ")}
                          disabled={disabled}
                          onClick={() => setCategoryToCodes(idsInCat, packView.codes)}
                        >
                          View
                        </button>
                      ) : null}

                      {packViewEdit ? (
                        <button
                          type="button"
                          className={[
                            "rounded-xl border px-3 py-2 text-xs font-medium transition disabled:opacity-50",
                            isExact(packViewEdit)
                              ? "border-transparent bg-foreground text-background"
                              : "border-border bg-card text-foreground hover:bg-accent",
                          ].join(" ")}
                          disabled={disabled}
                          onClick={() =>
                            setCategoryToCodes(idsInCat, packViewEdit.codes)
                          }
                        >
                          View &amp; Edit
                        </button>
                      ) : null}

                      {packManage ? (
                        <button
                          type="button"
                          className={[
                            "rounded-xl border px-3 py-2 text-xs font-medium transition disabled:opacity-50",
                            isExact(packManage)
                              ? "border-transparent bg-foreground text-background"
                              : "border-border bg-card text-foreground hover:bg-accent",
                          ].join(" ")}
                          disabled={disabled}
                          onClick={() =>
                            setCategoryToCodes(idsInCat, packManage.codes)
                          }
                        >
                          Manage
                        </button>
                      ) : null}

                      <button
                        type="button"
                        className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
                        disabled={disabled}
                        onClick={() => resetCategory(idsInCat)}
                        title="Reset this category"
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[420px] overflow-y-auto p-2">
                    <div className="space-y-2">
                      {perms.map((p) => {
                        const checked = selectedPermIds.includes(p.id);
                        return (
                          <label
                            key={p.id}
                            className={[
                              "flex items-start gap-3 rounded-2xl border px-3 py-3 transition",
                              !canManage || saving
                                ? "cursor-not-allowed opacity-70 border-border bg-card"
                                : "cursor-pointer border-border bg-card hover:bg-accent/50",
                            ].join(" ")}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePerm(p.id)}
                              disabled={!canManage || saving}
                              className="mt-1 h-4 w-4 rounded border-border"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="break-words text-sm font-medium text-foreground">
                                {p.label || "—"}
                              </div>
                              <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                                {p.code}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}