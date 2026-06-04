import { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { useToast } from "../../components/ui/toast";
import {
  listSeverities,
  createSeverity,
  updateSeverity,
  disableSeverity,
  listClassifications,
  createClassification,
  updateClassification,
  disableClassification,
  type SeverityItem,
  type ClassificationItem,
} from "../../api/dataModels";
import { useMe } from "../../contexts/MeContext";
import {
  NewGenButton,
  DeleteButton,
  EditGenButton,
  PowerOnButton,
} from "../../components/ui/IconButton";

type Tab = "severities" | "classifications";

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

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-2xl border px-4 py-2.5 text-sm font-medium transition",
        active
          ? "border-transparent bg-foreground text-background shadow-sm"
          : "border-border bg-card text-foreground hover:bg-accent",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export default function DataModels() {
  const { push } = useToast();

  const me = useMe();
  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canView =
    can("settings.data_models.view") || can("settings.data_models.manage");
  const canManage = can("settings.data_models.manage");

  const [tab, setTab] = useState<Tab>("severities");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(false);

  const [severities, setSeverities] = useState<SeverityItem[]>([]);
  const [classifications, setClassifications] = useState<ClassificationItem[]>(
    []
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [createCode, setCreateCode] = useState("");
  const [createLabel, setCreateLabel] = useState("");
  const [createOrder, setCreateOrder] = useState(0);

  const [editSev, setEditSev] = useState<SeverityItem | null>(null);
  const [editCls, setEditCls] = useState<ClassificationItem | null>(null);

  const [disableTarget, setDisableTarget] = useState<{
    kind: Tab;
    id: number;
    label: string;
  } | null>(null);

  const [enableTarget, setEnableTarget] = useState<{
    kind: Tab;
    id: number;
    label: string;
  } | null>(null);

  async function load() {
    if (!canView) return;
    setLoading(true);
    try {
      const [s, c] = await Promise.all([
        listSeverities(includeInactive),
        listClassifications(includeInactive),
      ]);
      setSeverities(s);
      setClassifications(c);
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
  }, [includeInactive, canView]);

  const visibleSev = useMemo(
    () =>
      severities
        .slice()
        .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)),
    [severities]
  );

  const visibleCls = useMemo(
    () => classifications.slice().sort((a, b) => a.label.localeCompare(b.label)),
    [classifications]
  );

  if (!canView) {
    return (
      <div className="space-y-3">
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          Data models
        </div>
        <div className="text-sm text-muted-foreground">Access denied.</div>
      </div>
    );
  }

  const list = tab === "severities" ? visibleSev : visibleCls;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-3xl font-semibold tracking-tight text-foreground">
            Data models
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Manage severity and classification values used across Doko.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <NewGenButton
            title="New element"
            onClick={() => {
              setCreateOpen(true);
              setCreateCode("");
              setCreateLabel("");
              setCreateOrder(0);
            }}
            disabled={loading || !canManage}
            iconOnly={false}
            label="New element"
          />
        </div>
      </div>

      <Card className="p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="text-sm font-semibold text-foreground">Scope</div>
            <div className="mt-1 flex flex-wrap gap-2">
              <TabButton
                active={tab === "severities"}
                onClick={() => setTab("severities")}
              >
                Severities ({visibleSev.length})
              </TabButton>
              <TabButton
                active={tab === "classifications"}
                onClick={() => setTab("classifications")}
              >
                Classifications ({visibleCls.length})
              </TabButton>
            </div>
          </div>

          <div className="min-w-0">
            <SettingCheckbox
              checked={includeInactive}
              onChange={setIncludeInactive}
              disabled={loading}
              label="Include inactive"
              hint="Show disabled values in the list."
            />
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-14 w-full animate-pulse rounded-2xl bg-muted"
              />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="text-lg font-semibold text-foreground">Empty</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Create items to use them in Cases and Alerts.
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <div className="min-w-[820px]">
                <div className="grid grid-cols-12 gap-3 border-b border-border bg-background/70 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <div className="col-span-3">Code</div>
                  <div className="col-span-5">Label</div>
                  {tab === "severities" ? (
                    <div className="col-span-1">Order</div>
                  ) : null}
                  <div className={tab === "severities" ? "col-span-1" : "col-span-2"}>
                    Status
                  </div>
                  <div className={tab === "severities" ? "col-span-2 text-right" : "col-span-2 text-right"}>
                    Actions
                  </div>
                </div>

                <div className="divide-y divide-border">
                  {list.map((x: any) => (
                    <div
                      key={x.id}
                      className="grid grid-cols-12 items-center gap-3 px-5 py-4 transition hover:bg-accent/30"
                    >
                      <div className="col-span-3 min-w-0">
                        <div
                          className="truncate font-mono text-xs text-foreground"
                          title={x.code}
                        >
                          {x.code}
                        </div>
                      </div>

                      <div className="col-span-5 min-w-0">
                        <div
                          className="truncate text-sm font-medium text-foreground"
                          title={x.label}
                        >
                          {x.label}
                        </div>
                      </div>

                      {tab === "severities" ? (
                        <div className="col-span-1 text-sm text-muted-foreground">
                          {x.order}
                        </div>
                      ) : null}

                      <div
                        className={
                          tab === "severities"
                            ? "col-span-1"
                            : "col-span-2"
                        }
                      >
                        <StatusPill active={!!x.is_active} />
                      </div>

                      <div
                        className={
                          tab === "severities"
                            ? "col-span-2 flex justify-end gap-2"
                            : "col-span-2 flex justify-end gap-2"
                        }
                      >
                        {canManage ? (
                          <>
                            <EditGenButton
                              onClick={() => {
                                if (tab === "severities") setEditSev(x as SeverityItem);
                                else setEditCls(x as ClassificationItem);
                              }}
                              disabled={loading}
                              title="Edit element"
                            >
                            </EditGenButton>

                            {x.is_active ? (
                              <DeleteButton
                                onClick={() =>
                                  setDisableTarget({
                                    kind: tab,
                                    id: x.id,
                                    label: x.label,
                                  })
                                }
                                title="Disable element"
                                disabled={loading}
                              />
                            ) : (
                              <PowerOnButton
                                onClick={() =>
                                  setEnableTarget({
                                    kind: tab,
                                    id: x.id,
                                    label: x.label,
                                  })
                                }
                                title="Re-enable element"
                                disabled={loading}
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
          </>
        )}
      </Card>

      <ConfirmDialog
        open={createOpen}
        title={`Create ${tab === "severities" ? "severity" : "classification"}`}
        confirmText="Save"
        confirmTag="save"
        cancelTag="cancel"
        onCancel={() => setCreateOpen(false)}
        onConfirm={async () => {
          if (!canManage || loading) return;
          const code = createCode.trim();
          const label = createLabel.trim();
          if (!code || !label) {
            push({
              kind: "error",
              title: "Missing fields",
              message: "code and label are required",
            });
            return;
          }
          setLoading(true);
          try {
            if (tab === "severities") {
              await createSeverity({
                code,
                label,
                order: Number(createOrder) || 0,
              });
            } else {
              await createClassification({ code, label });
            }
            push({ kind: "success", title: "Created" });
            setCreateOpen(false);
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
              <FieldLabel required>Code</FieldLabel>
              <SettingInput
                value={createCode}
                onChange={(e) => setCreateCode(e.target.value)}
                placeholder="ex: critical_high"
              />
            </label>

            <label className="block space-y-2">
              <FieldLabel required>Label</FieldLabel>
              <SettingInput
                value={createLabel}
                onChange={(e) => setCreateLabel(e.target.value)}
                placeholder="ex: Critical High"
              />
            </label>

            {tab === "severities" ? (
              <label className="block space-y-2">
                <FieldLabel>Order</FieldLabel>
                <SettingInput
                  type="number"
                  value={createOrder}
                  onChange={(e) => setCreateOrder(Number(e.target.value))}
                  placeholder="0"
                />
              </label>
            ) : null}
          </div>
        }
      />

      <ConfirmDialog
        open={!!editSev}
        title="Edit severity"
        confirmText="Save"
        confirmTag="save"
        onCancel={() => setEditSev(null)}
        onConfirm={async () => {
          if (!editSev || !canManage || loading) return;
          setLoading(true);
          const code = editSev.code.trim();
          const label = editSev.label.trim();

          if (!code || !label) {
            push({
              kind: "error",
              title: "Missing fields",
              message: "code and label are required",
            });
            return;
          }

          setLoading(true);
          try {
            await updateSeverity(editSev.id, {
              code,
              label,
              order: Number(editSev.order) || 0,
            });
            push({ kind: "success", title: "Updated" });
            setEditSev(null);
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
          editSev ? (
            <div className="space-y-4">
              <label className="block space-y-2">
                <FieldLabel required>Code</FieldLabel>
                <SettingInput
                  value={editSev.code}
                  onChange={(e) =>
                    setEditSev({ ...editSev, code: e.target.value })
                  }
                />
              </label>

              <label className="block space-y-2">
                <FieldLabel required>Label</FieldLabel>
                <SettingInput
                  value={editSev.label}
                  onChange={(e) =>
                    setEditSev({ ...editSev, label: e.target.value })
                  }
                />
              </label>

              <label className="block space-y-2">
                <FieldLabel>Order</FieldLabel>
                <SettingInput
                  type="number"
                  value={editSev.order}
                  onChange={(e) =>
                    setEditSev({ ...editSev, order: Number(e.target.value) })
                  }
                />
              </label>
            </div>
          ) : null
        }
      />

      <ConfirmDialog
        open={!!editCls}
        title="Edit classification"
        confirmText="Save"
        confirmTag="save"
        onCancel={() => setEditCls(null)}
        onConfirm={async () => {
          if (!editCls || !canManage || loading) return;
          const code = editCls.code.trim();
          const label = editCls.label.trim();

          if (!code || !label) {
            push({
              kind: "error",
              title: "Missing fields",
              message: "code and label are required",
            });
            return;
          }

          setLoading(true);
          try {
            await updateClassification(editCls.id, {
              code,
              label,
            });
            push({ kind: "success", title: "Updated" });
            setEditCls(null);
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
          editCls ? (
            <div className="space-y-4">
              <label className="block space-y-2">
                <FieldLabel required>Code</FieldLabel>
                <SettingInput
                  value={editCls.code}
                  onChange={(e) =>
                    setEditCls({ ...editCls, code: e.target.value })
                  }
                />
              </label>

              <label className="block space-y-2">
                <FieldLabel required>Label</FieldLabel>
                <SettingInput
                  value={editCls.label}
                  onChange={(e) =>
                    setEditCls({ ...editCls, label: e.target.value })
                  }
                />
              </label>
            </div>
          ) : null
        }
      />

      <ConfirmDialog
        open={!!disableTarget}
        title="Disable"
        confirmText="Disable"
        onCancel={() => setDisableTarget(null)}
        onConfirm={async () => {
          if (!disableTarget || !canManage || loading) return;
          setLoading(true);
          try {
            if (disableTarget.kind === "severities") {
              await disableSeverity(disableTarget.id);
            } else {
              await disableClassification(disableTarget.id);
            }
            push({ kind: "success", title: "Disabled" });
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
        message={disableTarget ? `Disable "${disableTarget.label}" ?` : ""}
      />


      <ConfirmDialog
        open={!!enableTarget}
        title="Re-enable"
        confirmText="Enable"
        confirmTag="save"
        cancelTag="cancel"
        onCancel={() => setEnableTarget(null)}
        onConfirm={async () => {
          if (!enableTarget || !canManage || loading) return;

          setLoading(true);
          try {
            if (enableTarget.kind === "severities") {
              await updateSeverity(enableTarget.id, { is_active: true });
            } else {
              await updateClassification(enableTarget.id, { is_active: true });
            }

            push({ kind: "success", title: "Enabled" });
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
        message={enableTarget ? `Re-enable "${enableTarget.label}" ?` : ""}
      />


    </div>
  );
}