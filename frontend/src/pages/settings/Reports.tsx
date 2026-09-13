import { useEffect, useMemo, useRef, useState } from "react";
import Card from "../../components/ui/Card";
import { useToast } from "../../components/ui/toast";
import { useMe } from "../../contexts/MeContext";
import {
  listReportTemplates,
  getReportTemplate,
  createReportTemplate,
  updateReportTemplate,
  deleteReportTemplate,
  previewReportTemplate,
  type ReportTemplate,
} from "../../api/settingsReports";
import {
  NewGenButton,
  SaveButton,
  DeleteButton,
  PreviewButton,
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

function TemplateStatPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

const DRAFT_TEMPLATE_ID = "__draft_template__";

export default function SettingsReports() {
  const { push } = useToast();
  const me = useMe();
  const can = (p: string) => !!me?.is_admin || !!me?.permissions?.includes(p);
  const canView = can("settings.reports.view");
  const canManage = can("settings.reports.manage");

  const [items, setItems] = useState<ReportTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReportTemplate | null>(null);
  const [isDraftNew, setIsDraftNew] = useState(false);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [html, setHtml] = useState(defaultTemplateHtml);
  const [css, setCss] = useState(defaultTemplateCss);

  const [previewCaseId, setPreviewCaseId] = useState<string>("");
  const [previewHtml, setPreviewHtml] = useState<string>("");

  const [helpOpen, setHelpOpen] = useState(false);
  const latestTemplateRequestRef = useRef(0);

  const selectedDirty = useMemo(() => {
    if (!selected && !isDraftNew) return false;

    if (!selected) {
      return (
        name.trim() !== "" ||
        description.trim() !== "" ||
        html !== defaultTemplateHtml ||
        css !== defaultTemplateCss
      );
    }

    return (
      name !== (selected.name || "") ||
      description !== (selected.description || "") ||
      isActive !== !!selected.is_active ||
      html !== (selected.html || defaultTemplateHtml) ||
      css !== (selected.css || defaultTemplateCss)
    );
  }, [selected, isDraftNew, name, description, isActive, html, css]);

  const draftListItem = useMemo<ReportTemplate | null>(() => {
    if (!isDraftNew) return null;
    return {
      id: DRAFT_TEMPLATE_ID,
      name: name.trim() || "New report",
      description: description.trim() || "Unsaved template",
      is_active: true,
      version: 0,
      html,
      css,
    } as ReportTemplate;
  }, [isDraftNew, name, description, html, css]);

  const filteredItems = useMemo(() => {
    return includeInactive ? items : items.filter((x) => x.is_active);
  }, [items, includeInactive]);

  const displayItems = useMemo(() => {
    return draftListItem ? [draftListItem, ...filteredItems] : filteredItems;
  }, [draftListItem, filteredItems]);

  async function refreshList() {
    if (!canView) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const r = await listReportTemplates({
        q,
        include_inactive: includeInactive,
      });
      setItems(r.results ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canView) {
      setItems([]);
      return;
    }
    void refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, includeInactive, canView]);

  async function selectTemplate(id: string) {
    if (!canView) return;

    const requestId = latestTemplateRequestRef.current + 1;
    latestTemplateRequestRef.current = requestId;

    if (id === DRAFT_TEMPLATE_ID) {
      setSelectedId(null);
      setSelected(null);
      setIsDraftNew(true);
      return;
    }

    setSelectedId(id);
    setIsDraftNew(false);
    setBusy(true);

    try {
      const t = await getReportTemplate(id);

      if (latestTemplateRequestRef.current !== requestId) return;

      setSelected(t);
      setName(t.name || "");
      setDescription(t.description || "");
      setIsActive(!!t.is_active);
      setHtml(t.html || defaultTemplateHtml);
      setCss(t.css || defaultTemplateCss);
      setPreviewHtml("");
    } catch (e: any) {
      if (latestTemplateRequestRef.current !== requestId) return;

      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
    } finally {
      if (latestTemplateRequestRef.current === requestId) {
        setBusy(false);
      }
    }
  }

  async function onNew() {
    if (!canManage) return;
    setSelectedId(null);
    setSelected(null);
    setIsDraftNew(true);
    setName("New report");
    setDescription("");
    setIsActive(true);
    setHtml(defaultTemplateHtml);
    setCss(defaultTemplateCss);
    setPreviewHtml("");
  }

  async function onSave() {
    if (!canManage || !name.trim()) return;
    setBusy(true);
    try {
      if (!selectedId) {
        const created = await createReportTemplate({
          name: name.trim(),
          description,
          is_active: true,
          html,
          css,
        } as any);
        push({ kind: "success", title: "Template created" });
        setIsDraftNew(false);
        await refreshList();
        await selectTemplate(created.id);
      } else {
        await updateReportTemplate(selectedId, {
          name: name.trim(),
          description,
          is_active: isActive,
          html,
          css,
        } as any);
        push({ kind: "success", title: "Template saved" });
        await refreshList();
        await selectTemplate(selectedId);
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
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!canManage || !selectedId) return;
    setBusy(true);
    try {
      await deleteReportTemplate(selectedId);
      push({ kind: "success", title: "Template disabled" });
      await refreshList();
      setSelectedId(null);
      setSelected(null);
      setIsDraftNew(false);
      setName("");
      setDescription("");
      setIsActive(true);
      setHtml(defaultTemplateHtml);
      setCss(defaultTemplateCss);
      setPreviewHtml("");
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onPreview() {
    if (!canManage) return;
    if (!previewCaseId) {
      push({
        kind: "info",
        title: "Pick a case",
        message: "Select a case to preview.",
      });
      return;
    }
    setBusy(true);
    try {
      const r = await previewReportTemplate({
        case_id: previewCaseId,
        html,
        css,
      });
      setPreviewHtml(wrapPreview(r.html, r.css));
      push({ kind: "success", title: "Preview generated" });
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


  if (!canView) {
    return (
      <div className="space-y-3">
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          Reports
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
            Reports
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage HTML/CSS report templates and preview them against a case.
          </p>
        </div>
      </div>

      <Card className="p-5">
        <button
          type="button"
          className="w-full cursor-pointer border-none bg-transparent p-0 text-left"
          onClick={() => setHelpOpen((v) => !v)}
          disabled={busy}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">
                Template fields (Jinja2)
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Show available variables, loops and helpers for report template rendering.
              </div>
            </div>
            <div className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              {helpOpen ? "Hide" : "Show"}
            </div>
          </div>
        </button>

        {helpOpen ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-background">
            <div className="hidden grid-cols-12 gap-3 border-b border-border bg-muted px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:grid">
              <div className="col-span-3">Field / expression</div>
              <div className="col-span-5">Example</div>
              <div className="col-span-4">Description</div>
            </div>

            <div className="divide-y divide-border">
              {JINJA_FIELDS.map((f) => (
                <div
                  key={f.expr}
                  className="grid gap-2 px-4 py-3 text-xs text-foreground md:grid-cols-12 md:gap-3"
                >
                  <div className="md:col-span-3">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:hidden">
                      Field / expression
                    </div>
                    <div
                      className="truncate font-mono text-muted-foreground"
                      title={f.expr}
                    >
                      {f.expr}
                    </div>
                  </div>

                  <div className="md:col-span-5">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:hidden">
                      Example
                    </div>
                    <div
                      className="truncate font-mono text-wrap text-muted-foreground"
                      title={f.example}
                    >
                      {f.example}
                    </div>
                  </div>

                  <div className="md:col-span-4">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:hidden">
                      Description
                    </div>
                    <div title={f.description}>{f.description}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t italic border-border px-6 py-6 text-xs text-muted-foreground">
              Tip: use filters like <span className="font-mono">|nl2br</span>,{" "}
              <span className="font-mono">|format_date</span> and{" "}
              <span className="font-mono">|tojson</span>. Loops are supported with{" "}
              <span className="font-mono">{`{% for ... %}`}</span>. Undefined variables
              raise an error with StrictUndefined.
            </div>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="mb-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">Templates list</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <TemplateStatPill>
                    {items.length} template{items.length > 1 ? "s" : ""}
                  </TemplateStatPill>
                  <TemplateStatPill>
                    {items.filter((x) => x.is_active).length} active
                  </TemplateStatPill>
                </div>
              </div>

              <NewGenButton
                disabled={busy || !canManage}
                onClick={onNew}
                title="New report"
                iconOnly={true}
              />
            </div>

            <div className="space-y-2">
              <FieldLabel>Search</FieldLabel>
              <SettingInput
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search..."
                disabled={busy}
                className="h-8"
              />

              <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 cursor-pointer rounded border-border"
                  checked={includeInactive}
                  onChange={(e) => setIncludeInactive(e.target.checked)}
                  disabled={busy}
                />
                <span>Include inactive</span>
              </label>
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
          ) : displayItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-8 text-sm text-muted-foreground">
              No templates found.
            </div>
          ) : (
            <div className="space-y-2">
              {displayItems.map((t) => {
                const isDraftItem = t.id === DRAFT_TEMPLATE_ID;
                const isSelected = isDraftItem
                  ? isDraftNew && !selectedId
                  : selectedId === t.id;

                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      if (isDraftItem) return;
                      void selectTemplate(t.id);
                    }}
                    disabled={busy}
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
                  Template editor
                </div>
                {!isDraftNew ? <StatusPill active={isActive} /> : null}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Configure metadata, HTML and CSS.
              </div>
            </div>
            <div className="flex w-full flex-col gap-3 xl:w-auto xl:min-w-[420px]">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="block flex-1 space-y-2">
                  <FieldLabel>Preview with case</FieldLabel>
                  <SettingInput
                    value={previewCaseId}
                    onChange={(e) => setPreviewCaseId(e.target.value)}
                    placeholder="Paste case UUID..."
                    disabled={busy || !canManage}
                    className="h-8"
                  />
                </label>

                <PreviewButton
                  disabled={busy || !canManage}
                  onClick={onPreview}
                  title="Preview report"
                  iconOnly={true}
                  label="Preview"
                />
              </div>
            </div>
          </div>

          {previewHtml ? (
            <div className="mb-5 rounded-2xl border border-border bg-background p-2">
              <iframe
                title="preview"
                className="h-[360px] w-full rounded-xl bg-white"
                srcDoc={previewHtml}
                sandbox=""
                referrerPolicy="no-referrer"
              />
            </div>
          ) : null}

          <div className="space-y-5">
            <label className="block space-y-2">
              <FieldLabel required>Name</FieldLabel>
              <SettingInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy || !canManage}
                placeholder="Template name"
              />
            </label>

            <label className="block space-y-2">
              <FieldLabel>Description</FieldLabel>
              <SettingInput
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={busy || !canManage}
                placeholder="Short template description"
              />
            </label>

            {selectedId ? (
              <div className="rounded-2xl border border-border bg-background px-4 py-3">
                <label className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Template status
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Disable or reactivate this report template.
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <StatusPill active={isActive} />
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer rounded border-border"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      disabled={busy || !canManage}
                    />
                  </div>
                </label>
              </div>
            ) : null}

            <label className="block space-y-2">
              <FieldLabel>HTML (Jinja2)</FieldLabel>
              <SettingTextarea
                rows={18}
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                disabled={busy || !canManage}
                className="font-mono"
              />
              <SectionHint>
                Main HTML structure of the generated report.
              </SectionHint>
            </label>

            <label className="block space-y-2">
              <FieldLabel>CSS</FieldLabel>
              <SettingTextarea
                rows={12}
                value={css}
                onChange={(e) => setCss(e.target.value)}
                disabled={busy || !canManage}
                className="font-mono"
              />
              <SectionHint>
                Optional print and layout styling injected into the preview and rendered report.
              </SectionHint>
            </label>

            <div className="flex justify-end gap-2">
              <SaveButton
                disabled={busy || !canManage || !name.trim() || !selectedDirty}
                onClick={onSave}
                title="Save report"
                iconOnly={true}
              />
              {selectedId && isActive ? (
                <DeleteButton
                  disabled={busy || !canManage}
                  onClick={onDelete}
                  title="Disable report"
                  iconOnly={true}
                />
              ) : null}
            </div>

          </div>
        </Card>
      </div>
    </div>
  );
}

const defaultTemplateCss = `
@page {
  size: A4;
  margin: 16mm 14mm 19mm;
  @bottom-left { content: "Doko / Case report"; font-family: Arial, sans-serif; font-size: 8px; color: #64748b; }
  @bottom-right { content: counter(page) " / " counter(pages); font-family: Arial, sans-serif; font-size: 8px; color: #64748b; }
}

* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, sans-serif; font-size: 11px; line-height: 1.55; color: #17243a; background: #fff; }
.report { overflow-wrap: anywhere; }
.hero { padding: 10px 14px; margin-bottom: 14px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; text-align: center; }
.hero .case-title { margin: 5px 0 6px; font-size: 16px; line-height: 1.3; font-weight: normal; }
.hero .eyebrow { margin-bottom: 3px; }
.hero-subtitle { color: #64748b; }
.eyebrow { font-size: 9px; font-weight: bold; letter-spacing: .12em; text-transform: uppercase; color: #64748b; margin-bottom: 7px; }
h1 { margin: 0; font-size: 18px; line-height: 1.2; letter-spacing: -.025em; }
.hero-subtitle { margin-top: 3px; font-size: 10px; }
.grid-meta { display: table; table-layout: fixed; width: 100%; border-spacing: 6px 0; margin: 0 0 6px; }
.meta-row { display: table-row; }
.meta-card { display: table-cell; padding: 12px; vertical-align: top; border: 1px solid #e2e8f0; border-radius: 7px; background: #f5f7fa; }
.meta-label { font-size: 8px; font-weight: bold; letter-spacing: .08em; text-transform: uppercase; color: #64748b; margin-bottom: 6px; }
.meta-value { font-size: 11px; font-weight: bold; line-height: 1.5; }
.case-reference { margin: 7px 6px; font-size: 9px; color: #64748b; }
section { margin-top: 24px; }
h2 { margin: 0 0 12px; padding-bottom: 7px; border-bottom: 1px solid #dbe3eb; font-size: 14px; line-height: 1.3; break-after: avoid; }
h3 { font-size: 12px; line-height: 1.4; margin: 0 0 6px; }
.surface { padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 8px; }
.raw-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.prose-block { padding: 14px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
thead { display: table-header-group; }
thead th { text-align: left; padding: 9px 6px; background: #f5f7fa; border-bottom: 1px solid #dbe3eb; font-size: 8px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; }
tbody td { padding: 9px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; font-size: 10px; }
tbody tr:last-child td { border-bottom: 0; }
tr, .grid-meta { break-inside: avoid; }
.center { text-align: center; }
.mono, .json-block { font-family: "Liberation Mono", Consolas, monospace; }
.wrap, td, th, .meta-value { overflow-wrap: anywhere; }
.json-block { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 9px; }
.exchange { border-left: 3px solid #cbd5e1; padding: 0 0 0 14px; margin: 0 0 20px; }
.exchange-heading { padding: 10px 12px; background: #f5f7fa; border-radius: 6px; break-inside: avoid; break-after: avoid; }
.exchange-meta { font-size: 9px; color: #64748b; }
.exchange-body { padding: 12px 0 0; font-size: 10px; }
.footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 9px; text-align: right; }
`;

const defaultTemplateHtml = `
<div class="report">

  <header class="hero">
    <h1>Doko Case Report</h1>
    <div class="case-title">{{ case.title }}</div>
    <div class="eyebrow">Security incident / {{ case.case_number or case.id }}</div>
    <div class="hero-subtitle">Generated {{ generated_at|format_date }}{% if generated_by %} by {{ generated_by.username }}{% endif %}</div>
  </header>

  <div class="grid-meta">
    <div class="meta-row">
      {% for label, value in [("Status", case.status), ("Severity", case.severity), ("Classification", case.classification), ("Outcome", case.outcome)] %}
      <div class="meta-card"><div class="meta-label">{{ label }}</div><div class="meta-value">{{ (value or "-")|replace("_", " ") }}</div></div>
      {% endfor %}
    </div>
  </div>
  <div class="grid-meta">
    <div class="meta-row">
      <div class="meta-card"><div class="meta-label">Customer</div><div class="meta-value">{{ case.customer.name if case.customer else "-" }}</div></div>
      <div class="meta-card"><div class="meta-label">Owner</div><div class="meta-value">{{ case.owner.username if case.owner else "Unassigned" }}</div></div>
      <div class="meta-card"><div class="meta-label">Created</div><div class="meta-value">{{ case.created_at|format_date or "-" }}</div></div>
      <div class="meta-card"><div class="meta-label">Last update</div><div class="meta-value">{{ case.updated_at|format_date or "-" }}</div></div>
    </div>
  </div>
  <div class="case-reference">Case UUID <span class="mono">{{ case.id }}</span></div>
  {% if case.subgroups %}
  <div class="case-reference">Subgroups: {% for subgroup in case.subgroups %}{{ subgroup.name }}{% if not loop.last %}, {% endif %}{% endfor %}</div>
  {% endif %}

  <section>
    <h2>Description</h2>
    <div class="surface prose-block raw-text">{{ case.description or "No description provided." }}</div>
  </section>

{% if case.iocs %}
<section>
  <h2>Indicators of Compromise</h2>
  <div class="surface">
    <table>
      <thead>
        <tr>
          <th>Key</th>
          <th>Value</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {% for row in case.iocs %}
        <tr>
          <td>{{ row.get('key') or row.get('field') or "-" }}</td>
          <td class="mono wrap">{{ row.get('value') or "-" }}</td>
          <td>{{ row.get('status') or "-" }}</td>
        </tr>
        {% endfor %}
      </tbody>
    </table>
  </div>
</section>
{% endif %}

{% if case.assets %}
<section>
  <h2>Assets</h2>
  <div class="surface">
    <table>
      <thead>
        <tr>
          <th>Key</th>
          <th>Value</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {% for row in case.assets %}
        <tr>
          <td>{{ row.get('key') or row.get('field') or "-" }}</td>
          <td class="mono wrap">{{ row.get('value') or "-" }}</td>
          <td>{{ row.get('status') or "-" }}</td>
        </tr>
        {% endfor %}
      </tbody>
    </table>
  </div>
</section>
{% endif %}

  {% if workbook and workbook.items %}
  <section>
    <h2>Workbook</h2>
    <div class="surface">
      <table>
        <thead>
          <tr>
            <th style="width:72px;">Done</th>
            <th>Item</th>
            <th style="width:90px;">Order</th>
          </tr>
        </thead>
        <tbody>
          {% for it in workbook.items.all() %}
          <tr>
            <td class="center">{{ "Yes" if it.is_done else "No" }}</td>
            <td>{{ it.label }}</td>
            <td>{{ it.order or "-" }}</td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>
  </section>
  {% endif %}

  {% if linked_alerts %}
  <section>
    <h2>Linked alerts</h2>
    <div class="surface">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Severity</th>
            <th>Classification</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {% for a in linked_alerts %}
          <tr>
            <td>{{ a.title }}</td>
            <td>{{ a.status }}</td>
            <td>{{ a.severity or "-" }}</td>
            <td>{{ a.classification or "-" }}</td>
            <td>{{ a.created_at|format_date }}</td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>
  </section>
  {% endif %}

  {% if exchanges %}
  <section>
    <h2>Exchange</h2>
    {% for message in exchanges %}
    <article class="exchange">
      <div class="exchange-heading">
        <div class="eyebrow">{{ message.direction|replace("_", " ") }} / {{ message.channel }}</div>
        <h3>{{ message.subject or "No subject" }}</h3>
        <div class="exchange-meta">{{ message.created_at|format_date }}{% if message.sender %} · From: {{ message.sender }}{% endif %}</div>
        {% if message.to %}<div class="exchange-meta">To: {{ message.to|join(", ") }}</div>{% endif %}
        {% if message.cc %}<div class="exchange-meta">Cc: {{ message.cc|join(", ") }}</div>{% endif %}
        {% if message.message_id %}<div class="exchange-meta mono">Message ID: {{ message.message_id }}</div>{% endif %}
      </div>
      <div class="raw-text exchange-body">{{ message.body or "No message body." }}</div>
    </article>
    {% endfor %}
  </section>
  {% endif %}

  {% if params %}
  <section>
    <h2>Custom parameters</h2>
    <div class="surface">
      <pre class="json-block">{{ params|tojson }}</pre>
    </div>
  </section>
  {% endif %}

  <footer class="footer">
    Report generated {{ generated_at|format_date }}
    {% if generated_by %} — {{ generated_by.username }}{% endif %}
  </footer>
</div>
`;

const JINJA_FIELDS: Array<{
  expr: string;
  example: string;
  description: string;
}> = [
  {
    expr: "case.subgroups",
    example: "{% for subgroup in case.subgroups %}{{ subgroup.name }} ({{ subgroup.id }}){% endfor %}",
    description: "Subgroups explicitly assigned to this case; empty when none are assigned. Each subgroup also exposes description and contacts.",
  },
  {
    expr: "exchanges",
    example: '{% for message in exchanges %}<div style="white-space: pre-wrap">{{ message.body }}</div>{% endfor %}',
    description: "Case exchanges in chronological order. Body is literal text: HTML tags are displayed, never rendered. Empty when there are no messages.",
  },
  {
    expr: "message.subject / direction / channel / sender / to / cc / message_id / created_at",
    example: "{{ message.subject or '-' }} | {{ message.direction }} | {{ message.created_at|format_date }}",
    description: "Fields inside the exchanges loop. to and cc are lists: use |join(', '). Optional text fields may be empty.",
  },
  {
    expr: "comments",
    example: "{% for comment in comments %}{{ comment.author.username if comment.author else '-' }}: {{ comment.text }}{% endfor %}",
    description: "Case comments in chronological order, with text, author and created_at. HTML in comment text is escaped.",
  },
  {
    expr: "incident_timeline",
    example: "{% for item in incident_timeline %}{{ item.occurred_at|format_date }}: {{ item.title }} - {{ item.details }}{% endfor %}",
    description: "Incident timeline entries in chronological order, also exposing kind and source.",
  },
  {
    expr: "case.id",
    example: "{{ case.id }}",
    description: "Case UUID.",
  },
  {
    expr: "case.case_number",
    example: "{{ case.case_number or '' }}",
    description: "Case number if present.",
  },
  {
    expr: "case.title",
    example: "{{ case.title }}",
    description: "Case title.",
  },
  {
    expr: "case.status",
    example: "{{ case.status }}",
    description: "Case status.",
  },
  {
    expr: "case.severity",
    example: "{{ case.severity or '' }}",
    description: "Case severity code/value.",
  },
  {
    expr: "case.classification",
    example: "{{ case.classification or '' }}",
    description: "Case classification code/value.",
  },
  {
    expr: "case.outcome",
    example: "{{ case.outcome or '' }}",
    description: "Case outcome.",
  },
  {
    expr: "case.created_at",
    example: "{{ case.created_at|format_date }}",
    description: "Case creation datetime.",
  },
  {
    expr: "case.updated_at",
    example: "{{ case.updated_at|format_date }}",
    description: "Case last update datetime.",
  },
  {
    expr: "case.archived_at",
    example: "{{ case.archived_at|format_date if case.archived_at else '' }}",
    description: "Case archive datetime if the case is archived.",
  },
  {
    expr: "case.unarchived_at",
    example: "{{ case.unarchived_at|format_date if case.unarchived_at else '' }}",
    description: "Case unarchive datetime if available.",
  },
  {
    expr: "case.description",
    example: '<div style="white-space: pre-wrap">{{ case.description }}</div>',
    description:
      "Case description stored as Markdown text. HTML is escaped by the report engine. Preserve line breaks with white-space: pre-wrap, or use |nl2br|safe.",
  },

  {
    expr: "case.customer / case.customer_id",
    example: "{{ case.customer.name if case.customer else '' }}",
    description:
      "Customer relation. Preferred variant: case.customer.name. Raw UUID variant: {{ case.customer_id or '' }}.",
  },
  {
    expr: "case.owner / case.owner_id",
    example: "{{ case.owner.username if case.owner else '' }}",
    description:
      "Owner relation. Preferred variant: case.owner.username. Raw id variant: {{ case.owner_id or '' }}.",
  },

  {
    expr: "case.iocs",
    example: "{% for row in case.iocs %}...{% endfor %}",
    description:
      "List of IoCs stored on the case. Items are dict-like JSON rows.",
  },
  {
    expr: "row.get('key') / row.get('field')",
    example: "{{ row.get('key') or row.get('field') or '-' }}",
    description:
      "IoC/asset row key. Use .get(...) because rows are dicts and StrictUndefined is enabled. Some payloads use key, others field.",
  },
  {
    expr: "row.get('value')",
    example: "{{ row.get('value') or '-' }}",
    description: "IoC/asset row value.",
  },
  {
    expr: "row.get('status')",
    example: "{{ row.get('status') or '-' }}",
    description: "IoC/asset row status if present.",
  },

  {
    expr: "case.assets",
    example: "{% for row in case.assets %}...{% endfor %}",
    description:
      "List of assets stored on the case. Same dict access pattern as case.iocs.",
  },

  {
    expr: "generated_at",
    example: "{{ generated_at|format_date }}",
    description: "Report generation / preview timestamp.",
  },
  {
    expr: "generated_by.username",
    example: "{{ generated_by.username }}",
    description: "Username of the user who generated or previewed the report.",
  },
  {
    expr: "generated_by.email",
    example: "{{ generated_by.email or '' }}",
    description: "Email of the user who generated or previewed the report.",
  },

  {
    expr: "workbook",
    example: "{% if workbook %}...{% endif %}",
    description: "Workbook instance for the case, or null if none is applied.",
  },
  {
    expr: "workbook.template",
    example: "{{ workbook.template.name if workbook and workbook.template else '' }}",
    description:
      "Workbook template relation if present. Variant: {{ workbook.template.id if workbook and workbook.template else '' }}.",
  },
  {
    expr: "workbook.items",
    example: "{% for it in workbook.items.all() %}...{% endfor %}",
    description:
      "Workbook items relation. With the current backend, prefer workbook.items.all() in loops.",
  },
  {
    expr: "it.label",
    example: "{{ it.label }}",
    description: "Workbook item label inside the workbook loop.",
  },
  {
    expr: "it.is_done",
    example: `{{ "✓" if it.is_done else "" }}`,
    description: "Workbook item done state inside the workbook loop.",
  },
  {
    expr: "it.order",
    example: "{{ it.order }}",
    description: "Workbook item order inside the workbook loop.",
  },

  {
    expr: "linked_alerts",
    example: "{% for a in linked_alerts %}...{% endfor %}",
    description: "QuerySet of alerts linked to the case.",
  },
  {
    expr: "a.id",
    example: "{{ a.id }}",
    description: "Linked alert UUID inside the linked_alerts loop.",
  },
  {
    expr: "a.title",
    example: "{{ a.title }}",
    description: "Linked alert title inside the linked_alerts loop.",
  },
  {
    expr: "a.status",
    example: "{{ a.status }}",
    description: "Linked alert status inside the linked_alerts loop.",
  },
  {
    expr: "a.severity",
    example: "{{ a.severity or '' }}",
    description: "Linked alert severity inside the linked_alerts loop.",
  },
  {
    expr: "a.classification",
    example: "{{ a.classification or '' }}",
    description: "Linked alert classification inside the linked_alerts loop.",
  },
  {
    expr: "a.description",
    example: "{{ a.description or '' }}",
    description: "Linked alert description inside the linked_alerts loop.",
  },
  {
    expr: "a.source",
    example: "{{ a.source or '' }}",
    description: "Linked alert source if present.",
  },
  {
    expr: "a.created_at",
    example: "{{ a.created_at|format_date }}",
    description: "Linked alert creation datetime inside the loop.",
  },

  {
    expr: "params",
    example: "{{ params|tojson }}",
    description: "Custom params dict sent when previewing or generating the report.",
  },
  {
    expr: "params.get('some_key')",
    example: "{{ params.get('some_key', '') }}",
    description:
      "Safe way to read a custom param key from the params dict. Preferred with StrictUndefined.",
  },
  {
    expr: "params.some_key",
    example: "{{ params.some_key or '' }}",
    description:
      "Alternate dotted access for params. Works when the key exists, but params.get(...) is safer.",
  },
];

function wrapPreview(html: string, css: string) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${css || ""}</style></head>
<body>${html}</body></html>`;
}
