import { useEffect, useMemo, useRef, useState } from "react";
import Card from "../../components/ui/Card";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { useToast } from "../../components/ui/toast";
import { api } from "../../api/client";
import {
  createWorkbookTemplate,
  patchWorkbookTemplate,
  deleteWorkbookTemplate,
  createWorkbookTemplateItem,
  patchWorkbookTemplateItem,
  deleteWorkbookTemplateItem,
} from "../../api/settingsWorkbooks";
import { useMe } from "../../contexts/MeContext";
import {
  DeleteButton,
  NewGenButton,
  UpButton,
  DownButton,
} from "../../components/ui/IconButton";

type WorkbookTemplate = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

type WorkbookTemplateItem = {
  id: string;
  label: string;
  order: number;
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
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
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
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

export default function SettingsWorkbooks() {
  const { push } = useToast();

  const me = useMe();

  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canView =
    can("settings.workbooks.view") || can("settings.workbooks.manage");
  const canManage = can("settings.workbooks.manage");

  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<WorkbookTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);

  const [tplName, setTplName] = useState("");
  const [tplBusy, setTplBusy] = useState(false);

  const [itemsLoading, setItemsLoading] = useState(false);
  const [items, setItems] = useState<WorkbookTemplateItem[]>([]);
  const [itemBusyId, setItemBusyId] = useState<string | null>(null);

  const [newItemLabel, setNewItemLabel] = useState("");
  const [newItemBusy, setNewItemBusy] = useState(false);

  const [confirmDeleteTpl, setConfirmDeleteTpl] =
    useState<WorkbookTemplate | null>(null);
  const [confirmDeleteItem, setConfirmDeleteItem] =
    useState<WorkbookTemplateItem | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

  const latestItemsRequestRef = useRef(0);

  async function loadTemplates() {
    if (!canView) return;
    setLoading(true);
    try {
      const res = await api.get("/api/settings/workbook-templates/", {
        params: {
          q: q.trim() || undefined,
          include_inactive: includeInactive ? "1" : undefined,
        },
      });
      const list: WorkbookTemplate[] = Array.isArray(res.data)
        ? res.data
        : (res.data?.results ?? []);
      setTemplates(list);

      if (list.length && !selectedTemplateId) {
        setSelectedTemplateId(list[0].id);
      } else if (
        selectedTemplateId &&
        !list.some((t) => t.id === selectedTemplateId)
      ) {
        setSelectedTemplateId(list.length ? list[0].id : null);
      }
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
      setTemplates([]);
      setSelectedTemplateId(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadItems(templateId: string) {
    const requestId = latestItemsRequestRef.current + 1;
    latestItemsRequestRef.current = requestId;

    setItemsLoading(true);
    try {
      const res = await api.get(
        `/api/settings/workbook-templates/${templateId}/items/`
      );
      if (latestItemsRequestRef.current !== requestId) return;

      const list: WorkbookTemplateItem[] = Array.isArray(res.data)
        ? res.data
        : (res.data?.results ?? []);
      setItems(list);
    } catch (e: any) {
      if (latestItemsRequestRef.current !== requestId) return;

      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
      setItems([]);
    } finally {
      if (latestItemsRequestRef.current === requestId) {
        setItemsLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, includeInactive, canView]);

  useEffect(() => {
    if (selectedTemplateId) void loadItems(selectedTemplateId);
    else setItems([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplateId]);

  async function createTemplate() {
    const name = tplName.trim();
    if (!name || tplBusy || !canManage) return;

    setTplBusy(true);
    try {
      await createWorkbookTemplate({ name });
      push({ kind: "success", title: "Template created" });
      setTplName("");
      await loadTemplates();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setTplBusy(false);
    }
  }

  async function renameTemplate(templateId: string, nextName: string) {
    const name = nextName.trim();
    if (!name || !canManage) return;

    setTplBusy(true);
    try {
      await patchWorkbookTemplate(templateId, { name });
      setTemplates((prev) =>
        prev.map((t) => (t.id === templateId ? { ...t, name } : t))
      );
      push({ kind: "success", title: "Saved" });
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setTplBusy(false);
    }
  }

  async function deactivateTemplate(templateId: string) {
    if (!canManage) return;
    setTplBusy(true);
    try {
      await deleteWorkbookTemplate(templateId);
      push({ kind: "success", title: "Template disabled" });
      await loadTemplates();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
    } finally {
      setTplBusy(false);
    }
  }

  async function addItem() {
    if (!selectedTemplateId || !canManage) return;
    const label = newItemLabel.trim();
    if (!label || newItemBusy) return;

    setNewItemBusy(true);
    try {
      await createWorkbookTemplateItem(selectedTemplateId, { label });
      push({ kind: "success", title: "Item added" });
      setNewItemLabel("");
      await loadItems(selectedTemplateId);
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setNewItemBusy(false);
    }
  }

  async function patchItem(itemId: string, payload: Partial<WorkbookTemplateItem>) {
    if (!canManage) return;
    setItemBusyId(itemId);
    try {
      await patchWorkbookTemplateItem(itemId, payload);
      push({ kind: "success", title: "Saved" });
      if (selectedTemplateId) await loadItems(selectedTemplateId);
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setItemBusyId(null);
    }
  }

  async function deleteItem(itemId: string) {
    if (!canManage) return;
    setItemBusyId(itemId);
    try {
      await deleteWorkbookTemplateItem(itemId);
      push({ kind: "success", title: "Item deleted" });
      if (selectedTemplateId) await loadItems(selectedTemplateId);
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
    } finally {
      setItemBusyId(null);
    }
  }

  async function moveItem(itemId: string, direction: "up" | "down") {
    if (!canManage) return;
    const sorted = items
      .slice()
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
    const idx = sorted.findIndex((x) => x.id === itemId);
    if (idx < 0) return;

    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= sorted.length) return;

    const a = sorted[idx];
    const b = sorted[swapWith];

    setItemBusyId(itemId);
    try {
      await patchWorkbookTemplateItem(a.id, {
        order: b.order,
      });
      await patchWorkbookTemplateItem(b.id, {
        order: a.order,
      });
      push({ kind: "success", title: "Reordered" });
      if (selectedTemplateId) await loadItems(selectedTemplateId);
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setItemBusyId(null);
    }
  }

  if (!canView) {
    return (
      <div className="space-y-3">
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          Workbooks
        </div>
        <div className="text-sm text-muted-foreground">Access denied.</div>
      </div>
    );
  }

  const sortedTemplates = templates
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  const sortedItems = items
    .slice()
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-3xl font-semibold tracking-tight text-foreground">
            Workbooks
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Manage reusable workbook templates and checklist items for cases.
          </div>
        </div>
      </div>

      <Card className="p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="text-sm font-semibold text-foreground">
              Workbook templates
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatPill>
                {templates.length} template{templates.length > 1 ? "s" : ""}
              </StatPill>
              <StatPill>
                {templates.filter((x) => x.is_active).length} active
              </StatPill>
            </div>
          </div>

          <div className="min-w-0">
            <SettingCheckbox
              checked={includeInactive}
              onChange={setIncludeInactive}
              disabled={loading}
              label="Include inactive"
              hint="Show disabled templates in the list."
            />
          </div>
        </div>
      </Card>


      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">Workbook templates</div>

                <div className="space-y-2 mt-5 mb-5">
                  <FieldLabel required>New template</FieldLabel>
                  <div className="flex gap-2">
                    <SettingInput
                      placeholder="New template name..."
                      value={tplName}
                      onChange={(e) => setTplName(e.target.value)}
                      disabled={!canManage || tplBusy}
                    />
                    <NewGenButton
                      type="button"
                      onClick={createTemplate}
                      disabled={!canManage || tplBusy || !tplName.trim()}
                      title="New template"
                      iconOnly={false}
                      label="Create"
                    />
                  </div>
                </div>

              </div>
              <div className="text-xs text-muted-foreground">
                {loading ? "Loading…" : ""}
              </div>
            </div>

          {loading ? (
            <div className="space-y-2 py-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-2xl border border-border bg-muted"
                />
              ))}
            </div>
          ) : sortedTemplates.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-8 text-sm text-muted-foreground">
              No templates found.
            </div>
          ) : (
            <div className="space-y-2">
              {sortedTemplates.map((t) => {
                const active = selectedTemplateId === t.id;

                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTemplateId(t.id)}
                    className={[
                      "w-full cursor-pointer rounded-2xl border p-3 text-left transition",
                      "focus:outline-none focus:ring-2 focus:ring-foreground/10",
                      active
                        ? "border-transparent bg-foreground text-background shadow-sm"
                        : "border-border bg-card hover:bg-accent",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {t.name}
                        </div>
                        <div
                          className={[
                            "mt-1 text-xs",
                            active
                              ? "text-background/70"
                              : "text-muted-foreground",
                          ].join(" ")}
                        >
                          {formatDate(t.created_at)}
                        </div>
                      </div>

                      <div className="shrink-0 space-y-2 text-right">
                        <div>
                          <span
                            className={[
                              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                              active
                                ? "border-background/20 bg-background/10 text-background/80"
                                : t.is_active
                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                : "border-border bg-muted text-muted-foreground",
                            ].join(" ")}
                          >
                            {t.is_active ? "Active" : "Inactive"}
                          </span>
                        </div>

                        {active && canManage ? (
                          <div className="flex justify-end">
                            <DeleteButton
                              title="Delete template"
                              disabled={tplBusy}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setConfirmDeleteTpl(t);
                              }}
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">
                Template details
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Rename the template and manage its checklist items.
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {itemsLoading ? "Loading…" : ""}
            </div>
          </div>

          {!selectedTemplate ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-8 text-sm text-muted-foreground">
              Select a template.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-2">
                <FieldLabel>Name</FieldLabel>
                <SettingInput
                  key={selectedTemplate.id}
                  defaultValue={selectedTemplate.name}
                  disabled={!canManage || tplBusy}
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (!next) {
                      e.currentTarget.value = selectedTemplate.name;
                      return;
                    }
                    if (next !== selectedTemplate.name.trim()) {
                      void renameTemplate(selectedTemplate.id, next);
                    }
                  }}
                />
                <SectionHint>
                  Template id:{" "}
                  <span className="font-mono text-foreground">
                    {selectedTemplate.id}
                  </span>
                </SectionHint>
              </div>

              <div className="rounded-2xl border border-border bg-background p-4">
                <div className="space-y-2">
                  <FieldLabel required>New checklist item</FieldLabel>
                  <div className="flex gap-2">
                    <SettingInput
                      placeholder="New checklist item..."
                      value={newItemLabel}
                      onChange={(e) => setNewItemLabel(e.target.value)}
                      disabled={!canManage || newItemBusy}
                    />
                    <NewGenButton
                      onClick={addItem}
                      disabled={!canManage || newItemBusy || !newItemLabel.trim()}
                      title="Add line"
                      iconOnly={false}
                      label="Add"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {sortedItems.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-8 text-sm text-muted-foreground">
                    No items.
                  </div>
                ) : (
                  sortedItems.map((it, idx) => (
                    <div
                      key={it.id}
                      className="rounded-2xl border border-border bg-background p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <StatPill>Order {it.order}</StatPill>
                            {itemBusyId === it.id ? (
                              <StatPill>Saving…</StatPill>
                            ) : null}
                          </div>

                          <SettingInput
                            defaultValue={it.label}
                            disabled={!canManage || itemBusyId === it.id}
                            onBlur={(e) => {
                              const next = e.target.value.trim();
                              if (!next) {
                                e.currentTarget.value = it.label;
                                return;
                              }
                              if (next !== it.label.trim()) {
                                void patchItem(it.id, { label: next });
                              }
                            }}
                          />
                        </div>

                        <div className="flex shrink-0 items-start gap-2">
                          <div className="flex flex-col gap-2">
                            <UpButton
                              type="button"
                              disabled={
                                !canManage ||
                                itemBusyId === it.id ||
                                idx === 0
                              }
                              onClick={() => void moveItem(it.id, "up")}
                              title="Move up"
                            />
                            <DownButton
                              type="button"
                              disabled={
                                !canManage ||
                                itemBusyId === it.id ||
                                idx === sortedItems.length - 1
                              }
                              onClick={() => void moveItem(it.id, "down")}
                              title="Move down"
                            />
                          </div>

                          <DeleteButton
                            type="button"
                            disabled={!canManage || itemBusyId === it.id}
                            onClick={() => setConfirmDeleteItem(it)}
                            title="Delete line"
                          />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={!!confirmDeleteTpl}
        title="Disable template"
        message={
          confirmDeleteTpl
            ? `Disable template "${confirmDeleteTpl.name}" ?`
            : ""
        }
        confirmText="Disable"
        onCancel={() => {
          if (tplBusy) return;
          setConfirmDeleteTpl(null);
        }}
        onConfirm={async () => {
          if (!confirmDeleteTpl || !canManage || tplBusy) return;
          const target = confirmDeleteTpl;
          setConfirmDeleteTpl(null);
          await deactivateTemplate(target.id);
        }}
      />

      <ConfirmDialog
        open={!!confirmDeleteItem}
        title="Delete item"
        message={
          confirmDeleteItem
            ? `Delete item "${confirmDeleteItem.label}" ?`
            : ""
        }
        confirmText="Delete"
        onCancel={() => {
          if (itemBusyId) return;
          setConfirmDeleteItem(null);
        }}
        onConfirm={async () => {
          if (!confirmDeleteItem || !canManage || itemBusyId) return;
          const target = confirmDeleteItem;
          setConfirmDeleteItem(null);
          await deleteItem(target.id);
        }}
      />
    </div>
  );
}