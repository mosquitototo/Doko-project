import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  deleteAutomationRule,
  listAutomationRules,
  type AutomationRule,
} from "../../api/settingsAutomationRules";
import Card from "../../components/ui/Card";
import { useToast } from "../../components/ui/toast";
import { useMe } from "../../contexts/MeContext";
import {
  getCaseRetentionSettings,
  patchCaseRetentionSettings,
  type CaseRetentionSettings,
} from "../../api/settingsCases";
import {
  listCaseExchangeQuickparts,
  getCaseExchangeQuickpart,
  createCaseExchangeQuickpart,
  updateCaseExchangeQuickpart,
  deleteCaseExchangeQuickpart,
  type CaseExchangeQuickpart,
} from "../../api/settingsCaseExchange";
import {
  listInvestigationTemplates,
  type InvestigationTemplate,
} from "../../api/settingsChat";
import {
  NewGenButton,
  DeleteButton,
  SaveButton,
  EditGenButton,
  CloseButton,
} from "../../components/ui/IconButton";
import TiptapEditor from "../../components/ui/TiptapEditor";


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

const DRAFT_QUICKPART_ID = "__draft_quickpart__";

export default function SettingsCaseManagement() {
  const { push } = useToast();
  const navigate = useNavigate();
  const me = useMe();
  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);

  const canManageCaseSettings = can("settings.case_management.manage");
  const canViewQuickparts = can("case.view");
  const canManageQuickparts = can("case.update");
  const canManageInvestigationTemplates = can("chat.template.manage");
  const canViewAutomationRules = can("settings.automation_rules.view");
  const canManageAutomationRules = can("settings.automation_rules.manage");
  const canDeleteAutomationRules = can("settings.automation_rules.delete");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [autoArchiveDays, setAutoArchiveDays] = useState<number>(365);
  const [hardDeleteDays, setHardDeleteDays] = useState<number>(1825);
  const [initialRetention, setInitialRetention] = useState<{
    autoArchiveDays: number;
    hardDeleteDays: number;
  }>({
    autoArchiveDays: 365,
    hardDeleteDays: 1825,
  });
  const [sendTemplateId, setSendTemplateId] = useState("");
  const [initialSendTemplateId, setInitialSendTemplateId] = useState("");
  const [sendTemplates, setSendTemplates] = useState<InvestigationTemplate[]>([]);
  const [sendTemplatesLoading, setSendTemplatesLoading] = useState(false);

  const [qpItems, setQpItems] = useState<CaseExchangeQuickpart[]>([]);
  const [qpSelectedId, setQpSelectedId] = useState<string | null>(null);
  const [qpSelected, setQpSelected] = useState<CaseExchangeQuickpart | null>(null);
  const [qpIsDraftNew, setQpIsDraftNew] = useState(false);
  const [qpLoading, setQpLoading] = useState(false);
  const [qpBusy, setQpBusy] = useState(false);
  const [qpQ, setQpQ] = useState("");
  const [qpIncludeInactive, setQpIncludeInactive] = useState(false);

  const [qpName, setQpName] = useState("");
  const [qpDescription, setQpDescription] = useState("");
  const [qpIsActive, setQpIsActive] = useState(true);
  const [qpBody, setQpBody] = useState("");

  const [qpPreviewOpen, setQpPreviewOpen] = useState(false);
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([]);
  const [automationRulesLoading, setAutomationRulesLoading] = useState(false);


  useEffect(() => {
    let mounted = true;

    if (!canManageCaseSettings) {
      setLoading(false);
      return () => {
        mounted = false;
      };
    }

    void (async () => {
      try {
        const s = (await getCaseRetentionSettings()) as CaseRetentionSettings;
        if (!mounted) return;

        const nextAuto = s.auto_archive_after_days ?? 365;
        const nextHard = s.hard_delete_after_days ?? 1825;

        setAutoArchiveDays(nextAuto);
        setHardDeleteDays(nextHard);
        setInitialRetention({
          autoArchiveDays: nextAuto,
          hardDeleteDays: nextHard,
        });
        const nextSendTemplateId = String(s.exchange_send_template || "");

        setSendTemplateId(nextSendTemplateId);
        setInitialSendTemplateId(nextSendTemplateId);
      } catch {
        push({
          kind: "error",
          title: "Error",
          message: "Failed to load case settings",
        });
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [push, canManageCaseSettings]);

  const retentionDirty = useMemo(() => {
    return (
      autoArchiveDays !== initialRetention.autoArchiveDays ||
      hardDeleteDays !== initialRetention.hardDeleteDays ||
      sendTemplateId !== initialSendTemplateId
    );
  }, [
    autoArchiveDays,
    hardDeleteDays,
    initialRetention,
    sendTemplateId,
    initialSendTemplateId,
  ]);

  const sendTemplateDirty = useMemo(() => {
    return sendTemplateId !== initialSendTemplateId;
  }, [sendTemplateId, initialSendTemplateId]);

  const qpDirty = useMemo(() => {
    if (!qpSelected && !qpIsDraftNew) return false;

    if (!qpSelected) {
      return (
        qpName.trim() !== "" ||
        qpDescription.trim() !== "" ||
        qpIsActive !== true ||
        qpBody !== ""
      );
    }

    return (
      qpName !== (qpSelected.name || "") ||
      qpDescription !== (qpSelected.description || "") ||
      qpIsActive !== !!qpSelected.is_active ||
      qpBody !== (qpSelected.body || "")
    );
  }, [qpSelected, qpIsDraftNew, qpName, qpDescription, qpIsActive, qpBody]);

  const qpDraftListItem = useMemo<CaseExchangeQuickpart | null>(() => {
    if (!qpIsDraftNew) return null;
    return {
      id: DRAFT_QUICKPART_ID,
      name: qpName.trim() || "New quickpart",
      description: qpDescription.trim() || "Unsaved quickpart",
      is_active: true,
      body: qpBody,
    } as CaseExchangeQuickpart;
  }, [qpIsDraftNew, qpName, qpDescription, qpBody]);

  const qpFilteredItems = useMemo(() => {
    return qpIncludeInactive ? qpItems : qpItems.filter((x) => x.is_active);
  }, [qpItems, qpIncludeInactive]);

  const qpDisplayItems = useMemo(() => {
    return qpDraftListItem ? [qpDraftListItem, ...qpFilteredItems] : qpFilteredItems;
  }, [qpDraftListItem, qpFilteredItems]);

  async function onSave() {
    if (!canManageCaseSettings) return;
    if (
      !Number.isInteger(autoArchiveDays) ||
      !Number.isInteger(hardDeleteDays) ||
      autoArchiveDays < 1 ||
      hardDeleteDays < 1
    ) {
      push({
        kind: "error",
        title: "Invalid values",
        message: "Retention values must be positive integers.",
      });
      return;
    }

    if (hardDeleteDays < autoArchiveDays) {
      push({
        kind: "error",
        title: "Invalid values",
        message: "Hard delete must be greater than or equal to auto-archive.",
      });
      return;
    }

    setSaving(true);
    try {
      await patchCaseRetentionSettings({
        auto_archive_after_days: autoArchiveDays,
        hard_delete_after_days: hardDeleteDays,
        exchange_send_template: sendTemplateId || null,
      });

      setInitialRetention({
        autoArchiveDays,
        hardDeleteDays,
      });
      setInitialSendTemplateId(sendTemplateId);
      push({ kind: "success", title: "Saved" });
    } catch {
      push({ kind: "error", title: "Error", message: "Save failed" });
    } finally {
      setSaving(false);
    }
  }


  async function onSaveSendButtonConfig() {
    if (!canManageCaseSettings || !canManageInvestigationTemplates) return;

    setSaving(true);
    try {
      await patchCaseRetentionSettings({
        exchange_send_template: sendTemplateId || null,
      });

      setInitialSendTemplateId(sendTemplateId);
      push({ kind: "success", title: "Send button configuration saved" });
    } catch {
      push({ kind: "error", title: "Error", message: "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function refreshQuickparts() {
    if (!canViewQuickparts) {
      setQpItems([]);
      return;
    }
    setQpLoading(true);
    try {
      const r = await listCaseExchangeQuickparts({
        q: qpQ,
        include_inactive: qpIncludeInactive,
      });
      setQpItems(r.results ?? []);
    } catch {
      setQpItems([]);
    } finally {
      setQpLoading(false);
    }
  }


  async function refreshAutomationRules() {
    if (!canViewAutomationRules) {
      setAutomationRules([]);
      return;
    }

    setAutomationRulesLoading(true);

    try {
      const res = await listAutomationRules({ include_inactive: true });
      setAutomationRules(res.results ?? []);
    } catch {
      setAutomationRules([]);
      push({
        kind: "error",
        title: "Error",
        message: "Failed to load automation rules",
      });
    } finally {
      setAutomationRulesLoading(false);
    }
  }


  useEffect(() => {
    let mounted = true;

    if (!canManageCaseSettings || !canManageInvestigationTemplates) {
      setSendTemplates([]);
      return () => {
        mounted = false;
      };
    }

    void (async () => {
      setSendTemplatesLoading(true);
      try {
        const items = await listInvestigationTemplates();
        if (!mounted) return;

        setSendTemplates(
          (Array.isArray(items) ? items : []).filter((x) => x.is_enabled !== false)
        );
      } catch {
        if (mounted) setSendTemplates([]);
      } finally {
        if (mounted) setSendTemplatesLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [canManageCaseSettings, canManageInvestigationTemplates]);


  useEffect(() => {
    if (!canViewQuickparts) {
      setQpItems([]);
      return;
    }
    void refreshQuickparts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qpQ, qpIncludeInactive, canViewQuickparts]);

  async function selectQuickpart(id: string) {
    if (!canViewQuickparts) return;
    if (id === DRAFT_QUICKPART_ID) {
      setQpSelectedId(null);
      setQpSelected(null);
      setQpIsDraftNew(true);
      return;
    }

    setQpSelectedId(id);
    setQpIsDraftNew(false);
    setQpBusy(true);
    try {
      const t = await getCaseExchangeQuickpart(id);
      setQpSelected(t);
      setQpName(t.name || "");
      setQpDescription(t.description || "");
      setQpIsActive(!!t.is_active);
      setQpBody(t.body || "");
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
    } finally {
      setQpBusy(false);
    }
  }

  async function onNewQuickpart() {
    if (!canManageQuickparts) return;
    setQpSelectedId(null);
    setQpSelected(null);
    setQpIsDraftNew(true);
    setQpName("New quickpart");
    setQpDescription("");
    setQpIsActive(true);
    setQpBody("");
  }

  async function onSaveQuickpart() {
    if (!canManageQuickparts || !qpName.trim()) return;

    setQpBusy(true);
    try {
      if (!qpSelectedId) {
        const created = await createCaseExchangeQuickpart({
          name: qpName.trim(),
          description: qpDescription,
          is_active: true,
          body: qpBody,
        } as any);
        push({ kind: "success", title: "Quickpart created" });
        setQpIsDraftNew(false);
        await refreshQuickparts();
        await selectQuickpart(created.id);
      } else {
        await updateCaseExchangeQuickpart(qpSelectedId, {
          name: qpName.trim(),
          description: qpDescription,
          is_active: qpIsActive,
          body: qpBody,
        } as any);
        push({ kind: "success", title: "Quickpart saved" });
        await refreshQuickparts();
        await selectQuickpart(qpSelectedId);
      }
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setQpBusy(false);
    }
  }

  async function onDeleteQuickpart() {
    if (!canManageQuickparts || !qpSelectedId) return;

    setQpBusy(true);
    try {
      await deleteCaseExchangeQuickpart(qpSelectedId);
      push({ kind: "success", title: "Quickpart disabled" });
      await refreshQuickparts();
      setQpSelectedId(null);
      setQpSelected(null);
      setQpIsDraftNew(false);
      setQpName("");
      setQpDescription("");
      setQpIsActive(true);
      setQpBody("");
      setQpPreviewOpen(false);
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
    } finally {
      setQpBusy(false);
    }
  }


  async function onDeleteAutomationRule(rule: AutomationRule) {
    if (!canDeleteAutomationRules) return;

    const ok = window.confirm(`Delete automation rule "${rule.name}"?`);
    if (!ok) return;

    try {
      await deleteAutomationRule(rule.id);
      push({ kind: "success", title: "Automation rule deleted" });
      await refreshAutomationRules();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network"),
      });
    }
  }

  useEffect(() => {
    if (!canViewAutomationRules) {
      setAutomationRules([]);
      return;
    }

    void refreshAutomationRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewAutomationRules]);


  if (!canManageCaseSettings && !canViewQuickparts && !canViewAutomationRules) {
    return (
      <div className="space-y-3">
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          Case Management
        </div>
        <div className="text-sm text-muted-foreground">Access denied.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Case Management
          </h1>
        </div>
      </div>

      <Card className="p-5">
        <div className="mb-7 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">
              Case archiving
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Define when cases are archived automatically and when they are deleted permanently.
            </div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="h-20 w-full animate-pulse rounded-2xl bg-muted"
              />
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <label className="block space-y-2">
                <FieldLabel required>Auto-archive after (days)</FieldLabel>
                <SettingInput
                  type="number"
                  min={1}
                  value={autoArchiveDays}
                  disabled={!canManageCaseSettings || saving}
                  onChange={(e) => setAutoArchiveDays(Number(e.target.value))}
                />
                <SectionHint>
                  Cases are archived automatically after this delay.
                </SectionHint>
              </label>

              <label className="block space-y-2">
                <FieldLabel required>Hard delete after (days)</FieldLabel>
                <SettingInput
                  type="number"
                  min={1}
                  value={hardDeleteDays}
                  disabled={!canManageCaseSettings || saving}
                  onChange={(e) => setHardDeleteDays(Number(e.target.value))}
                />
                <SectionHint>
                  Must be greater than or equal to auto-archive.
                </SectionHint>
              </label>
            </div>

            <div className="flex justify-end">
              <SaveButton
                onClick={onSave}
                disabled={saving || !canManageCaseSettings || !retentionDirty}
                title="Save configuration"
                iconOnly={true}
                label={saving ? "Saving..." : "Save"}
              />
            </div>
          </div>
        )}
      </Card>

      <div className="space-y-6">
        <Card className="p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="text-sm font-semibold text-foreground">
                Case Exchange quickparts
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Manage reusable reply snippets for case exchanges.
              </div>
            </div>
          </div>


          <div className="grid mt-5 gap-6 xl:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)]">
            <Card className="p-5">
              <div className="mb-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      Quickparts list
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatPill>
                        {qpItems.length} quickpart{qpItems.length > 1 ? "s" : ""}
                      </StatPill>
                      <StatPill>
                        {qpItems.filter((x) => x.is_active).length} active
                      </StatPill>
                    </div>
                  </div>

                  <NewGenButton
                    disabled={qpBusy || !canManageQuickparts}
                    onClick={onNewQuickpart}
                    title="New quickpart"
                    iconOnly={true}
                  />
                </div>

                <div className="space-y-2">
                  <FieldLabel>Search</FieldLabel>
                  <SettingInput
                    value={qpQ}
                    onChange={(e) => setQpQ(e.target.value)}
                    placeholder="Search..."
                    disabled={qpBusy || !canViewQuickparts}
                    className="h-8"
                  />

                  <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 cursor-pointer rounded border-border"
                      checked={qpIncludeInactive}
                      onChange={(e) => setQpIncludeInactive(e.target.checked)}
                      disabled={qpBusy || !canViewQuickparts}
                    />
                    <span>Include inactive</span>
                  </label>
                </div>
              </div>

              {qpLoading ? (
                <div className="space-y-2 py-1">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-16 animate-pulse rounded-2xl border border-border bg-muted"
                    />
                  ))}
                </div>
              ) : qpDisplayItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-8 text-sm text-muted-foreground">
                  No quickparts found.
                </div>
              ) : (
                <div className="space-y-2">
                  {qpDisplayItems.map((t) => {
                    const isDraftItem = t.id === DRAFT_QUICKPART_ID;
                    const isSelected = isDraftItem
                      ? qpIsDraftNew && !qpSelectedId
                      : qpSelectedId === t.id;

                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          if (isDraftItem) return;
                          void selectQuickpart(t.id);
                        }}
                        disabled={qpBusy || !canViewQuickparts}
                        className={[
                          "w-full cursor-pointer rounded-2xl border p-3 text-left transition",
                          "focus:outline-none focus:ring-2 focus:ring-foreground/10",
                          isSelected
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
                                "mt-1 line-clamp-2 text-xs",
                                isSelected
                                  ? "text-background/70"
                                  : "text-muted-foreground",
                              ].join(" ")}
                            >
                              {t.description || "No description"}
                            </div>
                          </div>

                          <div className="shrink-0 space-y-1 text-right">
                            <div
                              className={[
                                "text-xs font-medium",
                                isSelected
                                  ? "text-background/70"
                                  : "text-muted-foreground",
                              ].join(" ")}
                            >
                              {isDraftItem ? "draft" : ""}
                            </div>
                            <div>
                              <span
                                className={[
                                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                  isSelected
                                    ? "border-background/20 bg-background/10 text-background/80"
                                    : isDraftItem
                                    ? "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-400"
                                    : t.is_active
                                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                    : "border-border bg-muted text-muted-foreground",
                                ].join(" ")}
                              >
                                {isDraftItem
                                  ? "Unsaved"
                                  : t.is_active
                                  ? "Active"
                                  : "Inactive"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <div className="text-sm font-semibold text-foreground">
                      Quickpart editor
                    </div>
                    {!qpIsDraftNew ? <StatusPill active={qpIsActive} /> : null}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Configure metadata and reusable reply content.
                  </div>
                </div>
              </div>

              <div className="space-y-5">
                <label className="block space-y-2">
                  <FieldLabel required>Name</FieldLabel>
                  <SettingInput
                    value={qpName}
                    onChange={(e) => setQpName(e.target.value)}
                    disabled={qpBusy || !canManageQuickparts}
                    placeholder="Quickpart name"
                  />
                </label>

                <label className="block space-y-2">
                  <FieldLabel>Description</FieldLabel>
                  <SettingInput
                    value={qpDescription}
                    onChange={(e) => setQpDescription(e.target.value)}
                    disabled={qpBusy || !canManageQuickparts}
                    placeholder="Short description"
                  />
                </label>

                {qpSelectedId ? (
                  <div className="rounded-2xl border border-border bg-background px-4 py-3">
                    <label className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          Quickpart status
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Disable or reactivate this quickpart.
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <StatusPill active={qpIsActive} />
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer rounded border-border"
                          checked={qpIsActive}
                          onChange={(e) => setQpIsActive(e.target.checked)}
                          disabled={qpBusy || !canManageQuickparts}
                        />
                      </div>
                    </label>
                  </div>
                ) : null}

                <div className="block space-y-2">
                  <FieldLabel>Body (HTML editor)</FieldLabel>
                  <div className="rounded-2xl border border-border bg-background p-3">
                    <TiptapEditor
                      value={qpBody}
                      onChange={setQpBody}
                      disabled={qpBusy || !canManageQuickparts}
                      placeholder="Write quickpart content..."
                      className="text-sm"
                    />
                  </div>
                  <SectionHint>
                    Content inserted into case exchange replies.
                  </SectionHint>
                </div>

                <div className="flex justify-end gap-2">
                  <SaveButton
                    disabled={qpBusy || !canManageQuickparts || !qpName.trim() || !qpDirty}
                    onClick={onSaveQuickpart}
                    title="Save quickpart"
                    iconOnly={true}
                  />
                  {qpSelectedId && qpIsActive ? (
                    <DeleteButton
                      disabled={qpBusy || !canManageQuickparts}
                      onClick={onDeleteQuickpart}
                      title="Disable quickpart"
                      iconOnly={true}
                    />
                  ) : null}
                </div>
              </div>
            </Card>
          </div>        
        </Card>


        <Card className="p-5">
        <div>
          <div className="mb-4">
            <div className="text-sm font-semibold text-foreground">
              Exchange Send button
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Select the investigation template used when using the "Send" button inside a case exchange message.
            </div>
          </div>

          <label className="block space-y-2">
            <FieldLabel>Investigation template</FieldLabel>
            <select
              value={sendTemplateId}
              onChange={(e) => setSendTemplateId(e.target.value)}
              disabled={
                saving ||
                sendTemplatesLoading ||
                !canManageCaseSettings ||
                !canManageInvestigationTemplates
              }
              className={[
                "h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none transition",
                "focus:border-ring focus:ring-2 focus:ring-ring/20",
                "disabled:cursor-not-allowed disabled:opacity-60",
              ].join(" ")}
            >
              <option value="">
                {sendTemplatesLoading ? "Loading templates..." : "No template"}
              </option>

              {sendTemplates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                  {tpl.remote_template_code ? ` · ${tpl.remote_template_code}` : ""}
                </option>
              ))}
            </select>

            {!canManageInvestigationTemplates ? (
              <SectionHint>
                You need investigation template management permission to select a template.
              </SectionHint>
            ) : (
              <SectionHint>
                The selected template receives the exchange metadata, including recipients,
                message_id and references.
              </SectionHint>
            )}
          </label>
        </div>
          <div className="flex justify-end">
            <SaveButton
              onClick={onSaveSendButtonConfig}
              disabled={
                saving ||
                sendTemplatesLoading ||
                !canManageCaseSettings ||
                !canManageInvestigationTemplates ||
                !sendTemplateDirty
              }
              title="Save Send button configuration"
              iconOnly={true}
              label={saving ? "Saving..." : "Save"}
            />
          </div>
        </Card>


        {canViewAutomationRules ? (
          <Card className="p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Automation Rules
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Configure automated actions for alerts, cases and hunts.
                </div>
              </div>

              {canManageAutomationRules ? (
                <NewGenButton
                  onClick={() =>
                    navigate("/settings/case-management/automation-rules/new")
                  }
                  title="Add automation rule"
                  iconOnly={true}
                />
              ) : null}
            </div>

            {automationRulesLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-14 w-full animate-pulse rounded-2xl bg-muted"
                  />
                ))}
              </div>
            ) : automationRules.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-8 text-sm text-muted-foreground">
                No automation rules configured.
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-muted/50 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Name</th>
                      <th className="px-4 py-3 font-semibold">Scope</th>
                      <th className="px-4 py-3 text-right font-semibold">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {automationRules.map((rule) => (
                      <tr key={rule.id} className="bg-card">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">
                            {rule.name}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {rule.is_enabled ? "Enabled" : "Disabled"}
                          </div>
                        </td>
                        <td className="px-4 py-3 capitalize text-muted-foreground">
                          {rule.scope}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            {canManageAutomationRules ? (
                              <EditGenButton
                                onClick={() =>
                                  navigate(
                                    `/settings/case-management/automation-rules/${rule.id}`
                                  )
                                }
                                title="Edit automation rule"
                                iconOnly={true}
                              />
                            ) : null}

                            {canDeleteAutomationRules ? (
                              <DeleteButton
                                onClick={() => void onDeleteAutomationRule(rule)}
                                title="Delete automation rule"
                                iconOnly={true}
                              />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ) : null}


      </div>

    </div>
  );
}