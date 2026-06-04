import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "../../../components/ui/Card";
import ConfirmDialog from "../../../components/ui/ConfirmDialog";
import { useToast } from "../../../components/ui/toast";
import { useMe } from "../../../contexts/MeContext";
import {
  listRoles,
  deleteRole,
  type RoleItem,
} from "../../../api/settingsRoles";
import {
  EditGenButton,
  DeleteButton,
  NewGenButton,
} from "../../../components/ui/IconButton";

function StatPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

export default function SettingsRoles() {
  const { push } = useToast();
  const navigate = useNavigate();

  const me = useMe();

  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canView = can("settings.access.roles.view");
  const canManage = can("settings.access.roles.manage");
  const canDelete = can("settings.access.roles.delete");

  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<RoleItem | null>(null);

  async function loadAll() {
    if (!canView) return;
    setLoading(true);
    try {
      const r = await listRoles();
      setRoles(r);
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
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  const roleCount = useMemo(() => roles.length, [roles]);
  const sortedRoles = useMemo(
    () => roles.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [roles]
  );

  if (!canView) {
    return (
      <div className="space-y-3">
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          Roles
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
            Roles
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Manage RBAC roles and the permission sets assigned to them.
          </div>
        </div>

        {canManage ? (
          <NewGenButton
            onClick={() => navigate("/settings/access-control/roles/new")}
            disabled={loading}
            title="New role"
            iconOnly={false}
            label="New role"
          />
        ) : null}
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">Role directory <StatPill>{roleCount} total</StatPill></div>
          </div>
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
        ) : sortedRoles.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="text-lg font-semibold text-foreground">No roles</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Create your first role.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-12 gap-3 border-b border-border bg-background/70 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <div className="col-span-3">Name</div>
                <div className="col-span-5">Description</div>
                <div className="col-span-2">Permissions</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>

              <div className="divide-y divide-border">
                {sortedRoles.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-12 items-center gap-3 px-5 py-4 transition hover:bg-accent/30"
                  >
                    <div className="col-span-3 min-w-0">
                      <div
                        className="truncate text-sm font-medium text-foreground"
                        title={r.name}
                      >
                        {r.name}
                      </div>
                    </div>

                    <div className="col-span-5 min-w-0">
                      <div
                        className="line-clamp-2 text-sm text-muted-foreground"
                        title={r.description || "—"}
                      >
                        {r.description || "—"}
                      </div>
                    </div>

                    <div className="col-span-2">
                      <StatPill>
                        {(r.permissions?.length ?? 0) === 0
                          ? "0"
                          : String(r.permissions.length)}
                      </StatPill>
                    </div>

                    <div className="col-span-2 flex justify-end gap-2">
                      {canManage ? (
                        <EditGenButton
                          onClick={() =>
                            navigate(`/settings/access-control/roles/${r.id}`)
                          }
                          disabled={loading}
                          title="Edit role"
                        />
                      ) : null}

                      {canDelete ? (
                        <DeleteButton
                          onClick={() => setConfirmDelete(r)}
                          disabled={loading}
                          title="Delete role"
                        />
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete role"
        confirmText="Delete"
        cancelText="Cancel"
        message={
          confirmDelete ? (
            <div className="space-y-2">
              <div className="text-sm text-foreground">
                Delete role <b>{confirmDelete.name}</b>?
              </div>
              <div className="text-xs text-muted-foreground">
                This removes role assignments but does not delete users.
              </div>
            </div>
          ) : null
        }
        onCancel={() => {
          if (loading) return;
          setConfirmDelete(null);
        }}
        onConfirm={async () => {
          if (!confirmDelete || !canDelete || loading) return;
          setLoading(true);
          try {
            await deleteRole(confirmDelete.id);
            push({ kind: "success", title: "Role deleted" });
            setConfirmDelete(null);
            await loadAll();
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
      />
    </div>
  );
}