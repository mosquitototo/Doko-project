import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import StatusBadge from "../../ui/StatusBadge";
import SeverityBadge from "../../ui/SeverityBadge";
import ClassificationBadge from "../../ui/ClassificationBadge";
import OutcomeBadge from "../../ui/OutcomeBadge";
import { Activity, ArchiveButton, CancelButton, DeleteButton, Info, NotebookText, OpenCloseToggleButton, SaveButton, UserRound, Workflow, LeftButton } from "../../ui/IconButton";
import { generateCaseReport } from "../../../api/caseReports";
import { updateTicket } from "../../../api/cases";
import type { EventDetail } from "../../../api/caseDetail";
import type { UserLite } from "../../../api/usersLite";
import type { Customer } from "../../../api/settingsCustomers";
import type { ClassificationItem, SeverityItem } from "../../../api/dataModels";
import { formatDate, outcomeOptions, statusOptions } from "./utils";

type ReportTemplate = { id: string; name: string; is_active: boolean; version: number };

type Props = {
  event: EventDetail;
  ticketId: string;
  busy: boolean;
  archiveBusy: boolean;
  busyCaseId: string | null;
  setBusyCaseId: React.Dispatch<React.SetStateAction<string | null>>;
  users: UserLite[];
  customers: Customer[];
  sevOptions: SeverityItem[];
  clsOptions: ClassificationItem[];
  editableRef: React.RefObject<HTMLDivElement | null>;
  editTitle: string;
  setEditTitle: React.Dispatch<React.SetStateAction<string>>;
  saveIfDirty: () => void | Promise<void>;
  changeStatus: (next: string) => void | Promise<void>;
  changeSeverity: (next: string) => void | Promise<void>;
  changeClassification: (next: string) => void | Promise<void>;
  changeOutcome: (next: string) => void | Promise<void>;
  refreshAll: () => Promise<void>;
  push: (toast: { kind: "success" | "error" | "info"; title: string; message?: string }) => void;
  isArchived: boolean;
  toggleArchive: () => void | Promise<void>;
  canUpdateCase: boolean;
  canDeleteCase: boolean;
  setConfirmDeleteCase: React.Dispatch<React.SetStateAction<boolean>>;
  reportTemplates: ReportTemplate[];
  reportTplId: string;
  setReportTplId: React.Dispatch<React.SetStateAction<string>>;
  reportBusy: boolean;
  setReportBusy: React.Dispatch<React.SetStateAction<boolean>>;
};

function InlineEditableBadge(props: {
  value: string;
  onChange: (next: string) => void | Promise<void>;
  disabled?: boolean;
  options: { value: string; label: string }[];
  display: ReactNode;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex items-center">
      <button
        type="button"
        disabled={props.disabled}
        aria-label={props.ariaLabel}
        title={props.ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        className={[
          "inline-flex border-none bg-transparent items-center rounded-xl transition",
          props.disabled
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer hover:scale-[1.05] focus:outline-none focus:ring-ring/20",
        ].join(" ")}
      >
        {props.display}
      </button>

      {open && !props.disabled ? (
        <div className="absolute left-0 top-full z-50 mt-2 min-w-[220px] overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
          <div className="max-h-72 overflow-auto p-1.5">
            {props.options.map((option) => {
              const selected = option.value === props.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={async () => {
                    setOpen(false);
                    if (option.value !== props.value) await props.onChange(option.value);
                  }}
                  className={[
                    "flex w-full border-none bg-transparent cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition",
                    selected
                      ? "bg-accent border-none bg-transparent text-accent-foreground"
                      : "text-foreground border-none bg-transparent hover:bg-accent/60",
                  ].join(" ")}
                >
                  <span>{option.label}</span>
                  {selected ? <span className="text-xs text-muted-foreground">Selected</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InlineTextBadge(props: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground shadow-sm">{props.children}</span>;
}

function InlineMutedBadge(props: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">{props.children}</span>;
}

function CaseSourcesInline(props: { sources: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!expanded) return;

    function onPointerDown(e: MouseEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setExpanded(false);
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setExpanded(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  const text = props.sources.length ? props.sources.join(", ") : "—";

  return (
    <div ref={rootRef} className="max-w-full min-w-0">
      <button
        type="button"
        onClick={() => {
          if (props.sources.length > 0) {
            setExpanded((prev) => !prev);
          }
        }}
        className={[
          "max-w-full border-none bg-transparent p-0 text-right text-xs italic text-muted-foreground",
          props.sources.length > 0 ? "cursor-pointer hover:text-foreground" : "cursor-default",
        ].join(" ")}
        title={props.sources.length > 0 ? text : undefined}
      >
        <span className="font-medium">Case source: </span>
        <span className={expanded ? "whitespace-normal break-words" : "inline-block max-w-[360px] truncate align-bottom"}>
          {text}
        </span>
      </button>
    </div>
  );
}


export default function CaseHeader(props: Props) {
  const navigate = useNavigate();
  const [titleActionsVisible, setTitleActionsVisible] = useState(false);

  const currentTitle = String((props.event as any).title ?? "");
  const nextTitle = props.editTitle.trim();
  const titleDirty = titleActionsVisible && nextTitle !== currentTitle;
  const caseSources = Array.isArray((props.event as any).case_sources)
    ? ((props.event as any).case_sources as unknown[])
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    : [];

  async function saveTitleEdit() {
    await props.saveIfDirty();
    setTitleActionsVisible(false);
  }

  function cancelTitleEdit() {
    props.setEditTitle(currentTitle);
    if (props.editableRef.current) {
      props.editableRef.current.textContent = currentTitle;
    }
    setTitleActionsVisible(false);
  }

  return (
    <>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Last update {formatDate((props.event as any).updated_at)}</span>
        <span className="font-mono">Case {props.event.id}</span>
      </div>

      <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex h-8 items-center">
            <LeftButton
              onClick={() => navigate("/cases")}
              title="Back"
              iconOnly
              className="px-1 py-1 h-fit min-h-0 line-height-none"
            />
          </div>
          <div
            ref={props.editableRef}
            contentEditable={props.canUpdateCase && !props.busy}
            role="textbox"
            tabIndex={0}
            suppressContentEditableWarning
            className="text-3xl font-semibold tracking-tight text-foreground outline-none px-1 py-0.5 rounded-md hover:bg-accent/40 focus:bg-accent/40 cursor-text"
            onInput={(e) => {
              setTitleActionsVisible(true);
              props.setEditTitle(e.currentTarget.textContent || "");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void saveTitleEdit();
              }
            }}
          />

          {titleDirty ? (
            <div className="mt-2 flex items-center gap-2">
              <SaveButton
                onClick={() => void saveTitleEdit()}
                disabled={props.busy || !props.canUpdateCase || !nextTitle}
                title="Save title"
              >
                Save
              </SaveButton>
              <CancelButton
                onClick={cancelTitleEdit}
                disabled={props.busy || !props.canUpdateCase}
                title="Cancel"
              />
            </div>
          ) : null}

          <div className="py-2">
            <div className="flex flex-wrap items-center gap-2">
              {(props.event as any).case_number ? <span className="text-sm font-medium text-muted-foreground">#{(props.event as any).case_number}</span> : null}
              <InlineEditableBadge
                value={String((props.event as any)?.customer || "")}
                disabled={!props.canUpdateCase || props.busyCaseId === (props.event as any)?.id}
                ariaLabel="Change customer"
                options={props.customers.filter((c) => c.is_active).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: String(c.id), label: c.name }))}
                onChange={async (next) => {
                  const nextCustomerId = next || null;
                  props.setBusyCaseId((props.event as any).id);
                  try {
                    await updateTicket(props.ticketId, { customer: nextCustomerId } as any);
                    props.push({ kind: "success", title: "Customer updated" });
                    await props.refreshAll();
                  } catch (err: any) {
                    props.push({ kind: "error", title: "Error", message: String(err?.response?.data?.detail ?? err?.response?.status ?? "network") });
                  } finally {
                    props.setBusyCaseId(null);
                  }
                }}
                display={<InlineTextBadge>{(props.event as any)?.customer_name || "No customer"}</InlineTextBadge>}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Workflow className="size-4 text-muted-foreground" />
              <InlineEditableBadge
                value={String((props.event as any).status || "")}
                onChange={props.changeStatus}
                disabled={props.busy || !props.canUpdateCase}
                options={statusOptions}
                ariaLabel="Change status"
                display={<StatusBadge status={(props.event as any).status} />}
              />
            </div>

            <div className="flex items-center gap-2">
              <Activity className="size-4 text-muted-foreground" />
              <InlineEditableBadge
                value={String((props.event as any).severity || "")}
                onChange={props.changeSeverity}
                disabled={props.busy || !props.canUpdateCase}
                options={props.sevOptions.slice().sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)).map((s) => ({ value: s.code, label: s.label }))}
                ariaLabel="Change severity"
                display={<SeverityBadge value={(props.event as any).severity} />}
              />
            </div>

            <div className="flex items-center gap-2">
              <NotebookText className="size-4 text-muted-foreground" />
              <InlineEditableBadge
                value={String((props.event as any).classification || "")}
                onChange={props.changeClassification}
                disabled={props.busy || !props.canUpdateCase}
                options={props.clsOptions.slice().sort((a, b) => a.label.localeCompare(b.label)).map((c) => ({ value: c.code, label: c.label }))}
                ariaLabel="Change classification"
                display={<ClassificationBadge value={(props.event as any).classification} />}
              />
            </div>

            <div className="flex items-center gap-2">
              <Info className="size-4 text-muted-foreground" />
              <InlineEditableBadge
                value={String((props.event as any).outcome || "unknown")}
                onChange={props.changeOutcome}
                disabled={props.busy || !props.canUpdateCase}
                options={outcomeOptions}
                ariaLabel="Change outcome"
                display={<OutcomeBadge value={String((props.event as any).outcome || "unknown")} />}
              />
            </div>

            <div className="flex items-center gap-2">
              <UserRound className="size-4 text-muted-foreground" />
              <InlineEditableBadge
                value={String((props.event as any).owner_id_read ?? (props.event as any).owner_id ?? "")}
                disabled={!props.canUpdateCase || props.busyCaseId === (props.event as any).id}
                ariaLabel="Change owner"
                options={props.users.map((u) => ({ value: String(u.id), label: u.username }))}
                onChange={async (next) => {
                  if (!next) return;
                  props.setBusyCaseId((props.event as any).id);
                  try {
                    await updateTicket(props.ticketId, { owner_id: Number(next) } as any);
                    props.push({ kind: "success", title: "Owner updated" });
                    await props.refreshAll();
                  } catch (err: any) {
                    props.push({ kind: "error", title: "Error", message: String(err?.response?.status ?? "network") });
                  } finally {
                    props.setBusyCaseId(null);
                  }
                }}
                display={<InlineTextBadge>{(props.event as any).owner_username || "Unassigned"}</InlineTextBadge>}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-3">
          <div className="flex items-center gap-2">
            <OpenCloseToggleButton
              isOpen={(props.event as any).status !== "closed"}
              iconOnly
              openTitle="Close case"
              closedTitle="Re-open case"
              onClick={async () => {
                if (props.busy) return;
                await props.changeStatus((props.event as any).status === "closed" ? "open" : "closed");
              }}
              disabled={props.busy || !props.canUpdateCase}
            />

            <ArchiveButton variant={props.isArchived ? "success" : "warning"} onClick={props.toggleArchive} disabled={props.busy || props.archiveBusy || !props.canUpdateCase}>
              {props.archiveBusy ? "Saving…" : props.isArchived ? "Unarchive" : "Archive"}
            </ArchiveButton>

            {props.canDeleteCase ? <DeleteButton onClick={() => props.setConfirmDeleteCase(true)} disabled={props.busy} /> : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <InlineEditableBadge
              value={String(props.reportTplId || "")}
              disabled={props.busy || props.reportBusy}
              ariaLabel="Select report template"
              options={props.reportTemplates.slice().sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ value: String(t.id), label: t.name }))}
              onChange={async (next) => props.setReportTplId(next)}
              display={
                <InlineMutedBadge>
                  {props.reportTplId
                    ? props.reportTemplates.find((t) => String(t.id) === String(props.reportTplId))?.name || "Report template"
                    : "Report template"}
                </InlineMutedBadge>
              }
            />

            <button
              className="rounded-xl cursor-pointer border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
              disabled={props.busy || props.reportBusy || !props.reportTplId}
              onClick={async () => {
                if (!props.ticketId || !props.reportTplId) return;
                props.setReportBusy(true);
                try {
                  const rep = await generateCaseReport(props.ticketId, props.reportTplId);
                  if ((rep as any).pdf_url) window.open((rep as any).pdf_url, "_blank", "noopener,noreferrer");
                  props.push({ kind: "success", title: "Report generated" });
                } catch (e: any) {
                  props.push({ kind: "error", title: "Error", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
                } finally {
                  props.setReportBusy(false);
                }
              }}
            >
              {props.reportBusy ? "Generating…" : "Gen PDF"}
            </button>
          </div>
          <CaseSourcesInline sources={caseSources} />
        </div>
      </div>
    </>
  );
}
