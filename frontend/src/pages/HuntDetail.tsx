import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import Card from "../components/ui/Card";
import StatusBadge from "../components/ui/StatusBadge";
import { useToast } from "../components/ui/toast";
import { useMe } from "../contexts/MeContext";
import { fetchUsersLite, type UserLite } from "../api/usersLite";
import { listCustomers, type Customer } from "../api/settingsCustomers";
import KeyValueEditor from "../components/ui/KeyValueEditor";
import MarkdownEditor from "../components/ui/MarkdownEditor";
import MarkdownRenderedContent from "../components/ui/MarkdownRenderedContent";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import {
  fetchHuntDetail,
  updateHunt,
  deleteHunt,
  listHuntJournal,
  createHuntJournalEntry,
  updateHuntJournalEntry,
  deleteHuntJournalEntry,
  listHuntCaseLinks,
  createHuntCaseLink,
  deleteHuntCaseLink,
  listHuntTimeline,
  archiveHunt,
  unarchiveHunt,
  type HuntDetail,
  type HuntJournalEntry,
  type HuntCaseLink,
  type HuntTimelineItem,
} from "../api/hunts";
import {
  fetchTickets,
  createTicket,
  updateTicket,
  type EventListItem,
} from "../api/cases";
import {
  DeleteButton,
  NewGenButton,
  SaveButton,
  EditGenButton,
  UserRound,
  Activity,
  Workflow,
  House,
  CancelButton,
  ArchiveButton,
  LeftButton,
} from "../components/ui/IconButton";




function formatDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function richTextToPlainText(html: string) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isRichTextEmpty(html: string) {
  return richTextToPlainText(html) === "";
}

function buildEscalationCaseTitle(huntTitle: string, noteHtml: string) {
  const noteText = richTextToPlainText(noteHtml);
  if (!noteText) return huntTitle || "New case";
  const shortNote =
    noteText.length > 80 ? `${noteText.slice(0, 80).trim()}…` : noteText;
  return huntTitle ? `${huntTitle} — ${shortNote}` : shortNote;
}

type Tab = "journal" | "iocs" | "assets" | "timeline";

const HUNT_STATUS_OPTIONS = [
  { value: "to_do", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "abandoned", label: "Abandoned" },
];

const HUNT_VERDICT_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  { value: "suspicious", label: "Suspicious" },
  { value: "malicious", label: "Malicious" },
  { value: "benign", label: "Benign" },
  { value: "false_positive", label: "False positive" },
];

const IOC_STATUS_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  { value: "observed", label: "Observed" },
  { value: "suspicious", label: "Suspicious" },
  { value: "malicious", label: "Malicious" },
  { value: "benign", label: "Benign" },
  { value: "false_positive", label: "False positive" },
];

const ASSET_STATUS_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  { value: "observed", label: "Observed" },
  { value: "suspicious", label: "Suspicious" },
  { value: "compromised", label: "Compromised" },
  { value: "remediated", label: "Remediated" },
];

const JOURNAL_TYPE_OPTIONS = [
  { value: "note", label: "Note" },
  { value: "query", label: "Query" },
  { value: "finding", label: "Finding" },
  { value: "pivot", label: "Pivot" },
  { value: "decision", label: "Decision" },
  { value: "escalation", label: "Escalation" },
];

function journalEntryTone(entryType?: string) {
  switch (entryType) {
    case "note":
      return "bg-slate-100 dark:bg-slate-900/60";
    case "query":
      return "bg-blue-50 dark:bg-blue-950/30";
    case "finding":
      return "bg-amber-50 dark:bg-amber-950/30";
    case "pivot":
      return "bg-violet-50 dark:bg-violet-950/30";
    case "decision":
      return "bg-emerald-50 dark:bg-emerald-950/30";
    case "escalation":
      return "bg-rose-50 dark:bg-rose-950/30";
    default:
      return "bg-slate-100 dark:bg-slate-900/60";
  }
}

function InlineEditableBadge(props: {
  value: string;
  onChange: (next: string) => void | Promise<void>;
  disabled?: boolean;
  options: { value: string; label: string }[];
  display: ReactNode;
  ariaLabel: string;
}) {
  const { value, onChange, disabled, options, display, ariaLabel } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setOpen(false);
      }
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
        disabled={disabled}
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        className={[
          "inline-flex border-none bg-transparent items-center rounded-xl transition",
          disabled
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer hover:scale-[1.05] focus:ring-2 focus:outline-none focus:ring-ring/20",
        ].join(" ")}
      >
        {display}
      </button>

      {open && !disabled ? (
        <div className="absolute left-0 top-full z-[60] mt-2 min-w-[220px] overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
          <div className="max-h-72 overflow-auto p-1.5">
            {options.map((option) => {
              const selected = option.value === value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={async () => {
                    setOpen(false);
                    if (option.value !== value) {
                      await onChange(option.value);
                    }
                  }}
                  className={[
                    "flex w-full border-none bg-transparent cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition",
                    selected
                      ? "bg-accent border-none bg-transparent text-accent-foreground"
                      : "text-foreground border-none bg-transparent hover:bg-accent/60",
                  ].join(" ")}
                >
                  <span>{option.label}</span>
                  {selected ? (
                    <span className="text-xs text-muted-foreground">Selected</span>
                  ) : null}
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
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground shadow-sm">
      {props.children}
    </span>
  );
}

export default function HuntDetailPage() {
  const { id } = useParams();
  const huntId = id || "";
  const navigate = useNavigate();
  const { push } = useToast();
  const me = useMe();
  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);

  const canManageHunt = can("hunt.manage");
  const canViewCases = can("case.view");
  const canCreateCases = can("case.add");
  const canUpdateCases = can("case.update");

  const canCreateCaseFromHunt = canManageHunt && canCreateCases && canUpdateCases;

  const canLinkCases = canManageHunt && canViewCases;

  const [hunt, setHunt] = useState<HuntDetail | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [titleActionsVisible, setTitleActionsVisible] = useState(false);
  const huntTitleRef = useRef<HTMLDivElement | null>(null);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cases, setCases] = useState<EventListItem[]>([]);
  const [journal, setJournal] = useState<HuntJournalEntry[]>([]);
  const [caseLinks, setCaseLinks] = useState<HuntCaseLink[]>([]);
  const [timeline, setTimeline] = useState<HuntTimelineItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("journal");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [contextSaving, setContextSaving] = useState(false);
  const [contextSavedAt, setContextSavedAt] = useState<number | null>(null);
  const [conclusionSaving, setConclusionSaving] = useState(false);
  const [conclusionSavedAt, setConclusionSavedAt] = useState<number | null>(null);

  const [newJournalType, setNewJournalType] = useState("note");
  const [newJournalText, setNewJournalText] = useState("");

  const [editContext, setEditContext] = useState("");
  const [editConclusion, setEditConclusion] = useState("");
  const [journalBusyId, setJournalBusyId] = useState<string | null>(null);
  const [editingJournalEntryId, setEditingJournalEntryId] = useState<string | null>(null);
  const [editingJournalText, setEditingJournalText] = useState("");
  const [editingJournalType, setEditingJournalType] = useState("note");

  const [createCaseOpen, setCreateCaseOpen] = useState(false);
  const [createCaseBusy, setCreateCaseBusy] = useState(false);
  const [newCaseTitle, setNewCaseTitle] = useState("");
  const [selectedIocKeys, setSelectedIocKeys] = useState<Record<string, boolean>>(
    {}
  );
  const [selectedAssetKeys, setSelectedAssetKeys] = useState<Record<string, boolean>>(
    {}
  );
  const [caseSourceEntry, setCaseSourceEntry] = useState<HuntJournalEntry | null>(null);

  const [linkingEntryId, setLinkingEntryId] = useState<string | null>(null);
  const [linkCaseIdByEntry, setLinkCaseIdByEntry] = useState<Record<string, string>>(
    {}
  );

  const contextSaveTimerRef = useRef<number | null>(null);
  const conclusionSaveTimerRef = useRef<number | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const location = useLocation();

  useEffect(() => {
    sessionStorage.setItem(`doko:chat:tab:${location.pathname}`, tab);
  }, [location.pathname, tab]);

  useEffect(() => {
    fetchUsersLite().then(setUsers).catch(() => setUsers([]));
    listCustomers({ include_inactive: false })
      .then((r) => setCustomers(r.results ?? []))
      .catch(() => setCustomers([]));
    if (canViewCases) {
      fetchTickets({ page: 1, page_size: 200, include_archived: "true" })
        .then((r) => setCases(r.results ?? []))
        .catch(() => setCases([]));
    } else {
      setCases([]);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (contextSaveTimerRef.current) {
        window.clearTimeout(contextSaveTimerRef.current);
      }
      if (conclusionSaveTimerRef.current) {
        window.clearTimeout(conclusionSaveTimerRef.current);
      }
    };
  }, []);


  async function refreshAll() {
    if (!huntId) return;
    const [h, j, l, t] = await Promise.all([
      fetchHuntDetail(huntId),
      listHuntJournal(huntId),
      listHuntCaseLinks(huntId),
      listHuntTimeline(huntId),
    ]);

    setHunt(h);
    setJournal(j);
    setCaseLinks(l);
    setTimeline(t);
    setEditTitle(h.title || "");
    setEditContext(h.context || "");
    setEditConclusion(h.conclusion || "");
  }

  useEffect(() => {
    void refreshAll();
  }, [huntId]);

  useEffect(() => {
    if (!huntTitleRef.current) return;
    if (huntTitleRef.current.textContent !== editTitle) {
      huntTitleRef.current.textContent = editTitle;
    }
  }, [editTitle]);

  useEffect(() => {
    function onChatPosted(event: Event) {
      const detail = (event as CustomEvent<{
        pageType?: string;
        objectId?: string;
      }>).detail;

      if (!detail) return;
      if (detail.pageType !== "hunt") return;
      if (String(detail.objectId || "") !== String(huntId || "")) return;

      void refreshAll();
    }

    window.addEventListener("doko:chat-posted", onChatPosted as EventListener);
    return () => {
      window.removeEventListener("doko:chat-posted", onChatPosted as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huntId]);

  const linkedCaseIds = useMemo(
    () => new Set(caseLinks.map((x) => x.case?.id).filter(Boolean)),
    [caseLinks]
  );

  const huntIocs = Array.isArray(hunt?.iocs) ? hunt.iocs : [];
  const huntAssets = Array.isArray(hunt?.assets) ? hunt.assets : [];

  function rowKey(row: any, index: number) {
    return `${String(row?.field ?? "").trim()}::${String(row?.value ?? "").trim()}::${index}`;
  }

  function initSelectionFromHunt() {
    const nextIocs: Record<string, boolean> = {};
    const nextAssets: Record<string, boolean> = {};

    huntIocs.forEach((row: any, index: number) => {
      nextIocs[rowKey(row, index)] = true;
    });

    huntAssets.forEach((row: any, index: number) => {
      nextAssets[rowKey(row, index)] = true;
    });

    setSelectedIocKeys(nextIocs);
    setSelectedAssetKeys(nextAssets);
  }

  function openCreateCaseModalFromEntry(entry: HuntJournalEntry) {
    setCaseSourceEntry(entry);
    setNewCaseTitle(buildEscalationCaseTitle(hunt?.title || "", entry.text || ""));
    initSelectionFromHunt();
    if (isRichTextEmpty(entry.text || "")) {
      push({
        kind: "error",
        title: "Empty escalation note",
        message: "The selected note is empty.",
      });
      return;
    }
    setCreateCaseOpen(true);
  }

  function selectedIocsForCase() {
    return huntIocs.filter(
      (row: any, index: number) => selectedIocKeys[rowKey(row, index)]
    );
  }

  function selectedAssetsForCase() {
    return huntAssets.filter(
      (row: any, index: number) => selectedAssetKeys[rowKey(row, index)]
    );
  }

  async function patchHunt(payload: Partial<HuntDetail>) {
    if (!canManageHunt) return;
    if (!huntId) return;
    setBusy(true);
    try {
      const updated = await updateHunt(huntId, payload);
      setHunt((prev) => (prev ? { ...prev, ...updated } : prev));
      await refreshAll();
      push({ kind: "success", title: "Hunt updated" });
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

  async function saveHuntTitle() {
    if (!hunt) return;

    const nextTitle = editTitle.trim();

    if (!nextTitle) {
      cancelHuntTitleEdit();
      return;
    }

    if (nextTitle === (hunt.title || "")) {
      setTitleActionsVisible(false);
      return;
    }

    await patchHunt({ title: nextTitle });
    setEditTitle(nextTitle);
    setTitleActionsVisible(false);
  }

  function cancelHuntTitleEdit() {
    const currentTitle = hunt?.title || "";
    setEditTitle(currentTitle);

    if (huntTitleRef.current) {
      huntTitleRef.current.textContent = currentTitle;
    }

    setTitleActionsVisible(false);
  }

  async function autosaveContext(context?: string) {
    if (!canManageHunt) return;
    if (!hunt) return;

    const nextContext = context ?? editContext;

    if ((hunt.context || "") === nextContext) return;

    setContextSaving(true);
    try {
      await updateHunt(huntId, { context: nextContext });
      setHunt((prev) => (prev ? { ...prev, context: nextContext } : prev));
      setEditContext(nextContext);
      setContextSavedAt(Date.now());
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setContextSaving(false);
    }
  }

  async function autosaveConclusion(conclusion?: string) {
    if (!canManageHunt) return;
    if (!hunt) return;

    const nextConclusion = conclusion ?? editConclusion;

    if ((hunt.conclusion || "") === nextConclusion) return;

    setConclusionSaving(true);
    try {
      await updateHunt(huntId, { conclusion: nextConclusion });
      setHunt((prev) => (prev ? { ...prev, conclusion: nextConclusion } : prev));
      setEditConclusion(nextConclusion);
      setConclusionSavedAt(Date.now());
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setConclusionSaving(false);
    }
  }

  function startEditJournalEntry(entry: HuntJournalEntry) {
    setEditingJournalEntryId(entry.id);
    setEditingJournalText(String(entry.text || ""));
    setEditingJournalType(String(entry.entry_type || "note"));
  }

  function cancelEditJournalEntry() {
    setEditingJournalEntryId(null);
    setEditingJournalText("");
    setEditingJournalType("note");
  }

  async function saveJournalEntry(entryId: string) {
    if (!canManageHunt) return;

    const nextText = editingJournalText;
    const nextType = editingJournalType;

    if (isRichTextEmpty(nextText)) return;

    setJournalBusyId(entryId);

    try {
      await updateHuntJournalEntry(entryId, {
        text: nextText,
        entry_type: nextType,
      });

      setJournal((prev) =>
        prev.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                text: nextText,
                entry_type: nextType,
              }
            : entry
        )
      );

      cancelEditJournalEntry();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setJournalBusyId(null);
    }
  }

  async function handleCreateCaseFromEscalation() {
    if (!canCreateCaseFromHunt) return;
    if (!hunt || !caseSourceEntry) return;
    if (!newCaseTitle.trim()) {
      push({ kind: "error", title: "Error", message: "Case title is required" });
      return;
    }

    setCreateCaseBusy(true);
    try {
      const fallbackOwnerId =
        hunt.owner_id_read ?? (users.length === 1 ? users[0].id : undefined);

      if (!fallbackOwnerId) {
        push({
          kind: "error",
          title: "Error",
          message: "Owner is required to create a case",
        });
        setCreateCaseBusy(false);
        return;
      }

      const created = await createTicket({
        title: newCaseTitle.trim(),
        description: caseSourceEntry.text || "",
        customer: hunt.customer || null,
        owner_id: fallbackOwnerId,
        status: "open",
      });

      await updateTicket(created.id, {
        iocs: selectedIocsForCase(),
        assets: selectedAssetsForCase(),
      });

      await createHuntCaseLink(huntId, {
        case_id: created.id,
        link_type: "created_from_hunt",
      });

      setCreateCaseOpen(false);
      setCaseSourceEntry(null);
      await refreshAll();
      push({ kind: "success", title: "Case created" });
      navigate(`/cases/${created.id}`);
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ??
            (typeof e?.response?.data === "string" ? e.response.data : "") ??
            e?.response?.status ??
            "network"
        ),
      });
    } finally {
      setCreateCaseBusy(false);
    }
  }

  async function handleLinkEscalationToCase(entry: HuntJournalEntry) {
    if (!canLinkCases) return;
    const caseId = linkCaseIdByEntry[entry.id] || "";
    if (!caseId) return;

    setBusy(true);
    try {
      await createHuntCaseLink(huntId, {
        case_id: caseId,
        link_type: "related",
      });
      setLinkCaseIdByEntry((prev) => ({ ...prev, [entry.id]: "" }));
      setLinkingEntryId(null);
      await refreshAll();
      push({ kind: "success", title: "Case linked" });
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

  async function removeCaseLink(linkId: string) {
    if (!canManageHunt) return;
    setBusy(true);
    try {
      await deleteHuntCaseLink(linkId);
      await refreshAll();
      push({ kind: "success", title: "Link removed" });
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

  async function toggleArchive() {
    if (!huntId || busy || archiveBusy || !canManageHunt) return;

    setArchiveBusy(true);
    try {
      if (isArchived) {
        await unarchiveHunt(huntId);
        push({ kind: "success", title: "Hunt unarchived" });
      } else {
        await archiveHunt(huntId);
        push({ kind: "success", title: "Hunt archived" });
      }
      await refreshAll();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(
          e?.response?.data?.detail ?? e?.response?.status ?? "network"
        ),
      });
    } finally {
      setArchiveBusy(false);
    }
  }

  async function onDelete() {
    if (!canManageHunt) return;
    if (!huntId) return;
    setBusy(true);
    try {
      await deleteHunt(huntId);
      push({ kind: "success", title: "Hunt deleted" });
      navigate("/hunts");
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
      setConfirmDelete(false);
    }
  }

  if (!hunt) {
    return <div className="p-6 text-sm text-slate-600">Loading…</div>;
  }

  const isArchived = !!hunt.archived_at;
  const nextTitle = editTitle.trim();
  const titleDirty = titleActionsVisible && nextTitle !== (hunt.title || "");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-xs italic text-muted-foreground">
          Last update {formatDate(hunt.updated_at)}
        </div>
        <div className="text-[10px] italic text-muted-foreground">
          Hunt ID {hunt.id}
        </div>
      </div>
      <div>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="mb-1 flex h-6 items-center">
            <LeftButton
              onClick={() => navigate("/hunts")}
              title="Back"
              iconOnly
              className="px-1 py-1 h-fit min-h-0 line-height-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <ArchiveButton
              variant={isArchived ? "success" : "warning"}
              onClick={toggleArchive}
              disabled={busy || archiveBusy || !canManageHunt}
              title={isArchived ? "Unarchive this hunt" : "Archive this hunt"}
            >
              {archiveBusy ? "Saving…" : isArchived ? "Unarchive" : "Archive"}
            </ArchiveButton>

            <DeleteButton
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={busy || archiveBusy || !canManageHunt}
              title="Delete hunt"
            />
          </div>
        </div>
        
        <div
          ref={huntTitleRef}
          contentEditable={canManageHunt && !busy}
          role="textbox"
          tabIndex={0}
          suppressContentEditableWarning
          className="truncate text-3xl font-semibold tracking-tight text-foreground outline-none px-1 py-0.5 rounded-md hover:bg-accent/40 focus:bg-accent/40 cursor-text"
          onInput={(e) => {
            setTitleActionsVisible(true);
            setEditTitle(e.currentTarget.textContent || "");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void saveHuntTitle();
            }
          }}
        />

        {titleDirty ? (
          <div className="mt-2 flex items-center gap-2">
            <SaveButton
              onClick={() => void saveHuntTitle()}
              disabled={busy || !canManageHunt || !nextTitle}
              title="Save title"
            >
              Save
            </SaveButton>
            <CancelButton
              onClick={cancelHuntTitleEdit}
              disabled={busy || !canManageHunt}
              title="Cancel"
            />
          </div>
        ) : null}
      </div>

      
      <div className="min-w-0">
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Workflow className="size-4 text-muted-foreground" />
            <InlineEditableBadge
              value={hunt.status}
              disabled={busy || !canManageHunt}
              onChange={async (next) => {
                await patchHunt({ status: next });
              }}
              options={HUNT_STATUS_OPTIONS}
              ariaLabel="Change hunt status"
              display={<StatusBadge status={hunt.status as any} />}
            />
          </div>

          <div className="flex items-center gap-2">
            <Activity className="size-4 text-muted-foreground" />
            <InlineEditableBadge
              value={hunt.verdict}
              disabled={busy || !canManageHunt}
              onChange={async (next) => {
                await patchHunt({ verdict: next });
              }}
              options={HUNT_VERDICT_OPTIONS}
              ariaLabel="Change hunt verdict"
              display={<InlineTextBadge>{HUNT_VERDICT_OPTIONS.find((o) => o.value === hunt.verdict)?.label ?? hunt.verdict}</InlineTextBadge>}
            />
          </div>

          <div className="flex items-center gap-2">
            <UserRound className="size-4 text-muted-foreground" />
            <InlineEditableBadge
              value={String(hunt.owner_id_read ?? "")}
              disabled={busy || !canManageHunt}
              onChange={async (next) => {
                await patchHunt({ owner_id: next ? Number(next) : null } as any);
              }}
              options={[
                { value: "", label: "Unassigned" },
                ...users.map((u) => ({
                  value: String(u.id),
                  label: u.username,
                })),
              ]}
              ariaLabel="Change hunt owner"
              display={
                <InlineTextBadge>
                  {users.find((u) => u.id === hunt.owner_id_read)?.username || "Unassigned"}
                </InlineTextBadge>
              }
            />
          </div>

          <div className="flex items-center gap-2">
            <House className="size-4 text-muted-foreground" />
            <InlineEditableBadge
              value={hunt.customer ?? ""}
              disabled={busy || !canManageHunt}
              onChange={async (next) => {
                await patchHunt({ customer: next || null });
              }}
              options={[
                { value: "", label: "All" },
                ...customers.map((c) => ({
                  value: String(c.id),
                  label: c.name,
                })),
              ]}
              ariaLabel="Change hunt customer"
              display={
                <InlineTextBadge>
                  {customers.find((c) => String(c.id) === String(hunt.customer ?? ""))?.name || "All"}
                </InlineTextBadge>
              }
            />
          </div>
        </div>
      </div>

      <Card className="relative z-20 overflow-visible p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col">
            <span className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Invest start
            </span>
            <input
              className="h-10 rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              type="datetime-local"
              disabled={busy || !canManageHunt}
              value={
                hunt.investigation_started_at
                  ? hunt.investigation_started_at.slice(0, 16)
                  : ""
              }
              onChange={(e) =>
                void patchHunt({
                  investigation_started_at: e.target.value || null,
                } as any)
              }
            />
          </label>

          <label className="flex flex-col">
            <span className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Invest end
            </span>
            <input
              className="h-10 rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              type="datetime-local"
              disabled={busy || !canManageHunt}
              value={
                hunt.investigation_finished_at
                  ? hunt.investigation_finished_at.slice(0, 16)
                  : ""
              }
              onChange={(e) =>
                void patchHunt({
                  investigation_finished_at: e.target.value || null,
                } as any)
              }
            />
          </label>

          <label className="flex flex-col">
            <span className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Search start
            </span>
            <input
              className="h-10 rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              type="datetime-local"
              disabled={busy || !canManageHunt}
              value={
                hunt.search_timeframe_start
                  ? hunt.search_timeframe_start.slice(0, 16)
                  : ""
              }
              onChange={(e) =>
                void patchHunt({
                  search_timeframe_start: e.target.value || null,
                } as any)
              }
            />
          </label>

          <label className="flex flex-col">
            <span className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Search end
            </span>
            <input
              className="h-10 rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              type="datetime-local"
              disabled={busy || !canManageHunt}
              value={
                hunt.search_timeframe_end
                  ? hunt.search_timeframe_end.slice(0, 16)
                  : ""
              }
              onChange={(e) =>
                void patchHunt({
                  search_timeframe_end: e.target.value || null,
                } as any)
              }
            />
          </label>
        </div>
      </Card>

      <div className="flex gap-2">
        {[
          { k: "journal", label: "Journal" },
          { k: "iocs", label: "IoCs" },
          { k: "assets", label: "Assets" },
          { k: "timeline", label: "Hunt timeline" },
        ].map((t: any) => (
          <button
            key={t.k}
            type="button"
            className={[
              "flex-1 border-none py-3 text-sm hover:bg-slate-800 hover:text-white font-semibold cursor-pointer transition-all duration-200 rounded-xl border-2 hover:-translate-y-1 active:scale-95",
              tab === t.k
                ? "bg-slate-800 text-white shadow-md hover:shadow-xl transform auto-scale-95"
                : "border-gray-100 bg-white shadow-md hover:shadow-xl hover:bg-slate-100 text-slate-500 hover:border-gray-300 hover:text-slate-700",
            ].join(" ")}
            onClick={() => setTab(t.k as Tab)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "journal" ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2 min-w-0">
            <Card className="p-5">
              <div className="mb-4 text-lg font-semibold text-foreground">
                New journal entry
              </div>

              <div className="space-y-3">
                <select
                  className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                  value={newJournalType}
                  onChange={(e) => setNewJournalType(e.target.value)}
                >
                  {JOURNAL_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>

                <MarkdownEditor
                  value={newJournalText}
                  onChange={(v) => setNewJournalText(v)}
                  disabled={busy || !canManageHunt}
                  placeholder="Write a note..."
                  className="text-sm text-foreground"
                />

                <NewGenButton
                  type="button"
                  onClick={async () => {
                    if (busy || !canManageHunt || isRichTextEmpty(newJournalText)) return;

                    setBusy(true);
                    try {
                      await createHuntJournalEntry(huntId, {
                        entry_type: newJournalType,
                        text: newJournalText,
                      });
                      push({ kind: "success", title: "Entry added" });
                      setNewJournalText("");
                      await refreshAll();
                    } catch (e: any) {
                      push({
                        kind: "error",
                        title: "Error",
                        message: String(
                          e?.response?.data?.detail ??
                            e?.response?.status ??
                            "network"
                        ),
                      });
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy || !canManageHunt || isRichTextEmpty(newJournalText)}
                  title="Add entry"
                  className="w-full"
                />
              </div>
            </Card>

            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-lg font-semibold text-foreground">Journal</div>
                <div className="text-xs text-muted-foreground">{journal.length}</div>
              </div>

              {journal.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-8 text-center">
                  <div className="text-sm font-medium text-foreground">
                    No journal entry yet
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Track notes, findings, pivots and escalations here.
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {journal
                    .slice()
                    .reverse()
                    .map((entry) => {
                      const isEscalation = entry.entry_type === "escalation";
                      const linkValue = linkCaseIdByEntry[entry.id] || "";

                      return (
                        <div
                          key={entry.id}
                          className={`rounded-2xl border border-border p-4 ${journalEntryTone(
                            entry.entry_type
                          )}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs text-muted-foreground">
                                {JOURNAL_TYPE_OPTIONS.find(
                                  (x) => x.value === entry.entry_type
                                )?.label ?? entry.entry_type}
                                {" • "}
                                {formatDate(entry.occurred_at)}
                                {entry.author_username
                                  ? ` • ${entry.author_username}`
                                  : ""}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {editingJournalEntryId === entry.id ? (
                                <>
                                  <SaveButton
                                    onClick={() => void saveJournalEntry(entry.id)}
                                    disabled={
                                      busy ||
                                      !canManageHunt ||
                                      journalBusyId === entry.id ||
                                      isRichTextEmpty(editingJournalText)
                                    }
                                    title="Save entry"
                                  >
                                    {journalBusyId === entry.id ? "Saving…" : "Save"}
                                  </SaveButton>

                                  <CancelButton
                                    onClick={cancelEditJournalEntry}
                                    disabled={busy || !canManageHunt || journalBusyId === entry.id}
                                    title="Cancel"
                                  />
                                </>
                              ) : (
                                <EditGenButton
                                  onClick={() => startEditJournalEntry(entry)}
                                  disabled={busy || !canManageHunt || journalBusyId === entry.id}
                                  title="Edit entry"
                                />
                              )}

                              <DeleteButton
                                onClick={async () => {
                                  setJournalBusyId(entry.id);
                                  try {
                                    await deleteHuntJournalEntry(entry.id);
                                    await refreshAll();
                                    push({ kind: "success", title: "Entry deleted" });
                                  } catch (e: any) {
                                    push({
                                      kind: "error",
                                      title: "Error",
                                      message: String(
                                        e?.response?.data?.detail ??
                                          e?.response?.status ??
                                          "network"
                                      ),
                                    });
                                  } finally {
                                    setJournalBusyId(null);
                                  }
                                }}
                                disabled={busy || !canManageHunt || journalBusyId === entry.id}
                                title="Delete entry"
                              />
                            </div>
                          </div>

                          {editingJournalEntryId === entry.id ? (
                            <div className="mt-3 space-y-3">
                              <select
                                value={editingJournalType}
                                onChange={(e) => setEditingJournalType(e.target.value)}
                                disabled={busy || !canManageHunt || journalBusyId === entry.id}
                                className="h-10 rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-primary"
                              >
                                {JOURNAL_TYPE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>

                              <MarkdownEditor
                                value={editingJournalText}
                                onChange={(next) => setEditingJournalText(next)}
                                disabled={busy || !canManageHunt || journalBusyId === entry.id}
                                placeholder="Edit entry..."
                                className="text-sm text-foreground"
                              />
                            </div>
                          ) : (
                            <div className="mt-3 min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_*]:break-words [&_*]:[overflow-wrap:anywhere] [&_a]:break-all [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_code]:whitespace-pre-wrap [&_code]:break-words [&_code]:[overflow-wrap:anywhere]">
                              <MarkdownRenderedContent
                                markdown={String(entry.text || "")}
                                className="min-w-0 max-w-full"
                              />
                            </div>
                          )}

                          {isEscalation ? (
                            <div className="mt-4 space-y-3">
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                <button
                                  type="button"
                                  className="rounded-2xl cursor-pointer border border-border bg-card px-3 py-2 text-xs font-medium text-foreground shadow-sm transition hover:-translate-y-0.5 hover:bg-accent/60 disabled:opacity-50"
                                  onClick={() => openCreateCaseModalFromEntry(entry)}
                                  disabled={busy || !canCreateCaseFromHunt || journalBusyId === entry.id}
                                >
                                  Create case
                                </button>

                                <button
                                  type="button"
                                  className="rounded-2xl cursor-pointer border border-border bg-card px-3 py-2 text-xs font-medium text-foreground shadow-sm transition hover:-translate-y-0.5 hover:bg-accent/60 disabled:opacity-50"
                                  onClick={() =>
                                    setLinkingEntryId((prev) =>
                                      prev === entry.id ? null : entry.id
                                    )
                                  }
                                  disabled={busy || !canLinkCases || journalBusyId === entry.id}
                                >
                                  Link case
                                </button>
                              </div>

                              {linkingEntryId === entry.id ? (
                                <div className="flex items-start gap-2">
                                  <select
                                    className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                                    value={linkValue}
                                    onChange={(e) =>
                                      setLinkCaseIdByEntry((prev) => ({
                                        ...prev,
                                        [entry.id]: e.target.value,
                                      }))
                                    }
                                    disabled={busy || !canLinkCases}
                                  >
                                    <option value="">— Select a case</option>
                                    {cases
                                      .filter((c) => !linkedCaseIds.has(c.id))
                                      .map((c) => (
                                        <option key={c.id} value={c.id}>
                                          {c.case_number ? `#${c.case_number} — ` : ""}
                                          {c.title}
                                        </option>
                                      ))}
                                  </select>

                                  <NewGenButton
                                    type="button"
                                    disabled={busy || !canLinkCases || !linkValue}
                                    onClick={() => void handleLinkEscalationToCase(entry)}
                                    title="Link case"
                                  />
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-lg font-semibold text-foreground">
                  Context / objective
                </div>
                <div className="text-xs text-muted-foreground">
                  {contextSaving ? "Saving…" : contextSavedAt ? "Saved" : ""}
                </div>
              </div>

              <textarea
                value={editContext}
                onChange={(e) => setEditContext(e.target.value)}
                onBlur={() => {
                  if (contextSaveTimerRef.current) {
                    window.clearTimeout(contextSaveTimerRef.current);
                  }

                  void autosaveContext(editContext);
                }}
                disabled={busy || !canManageHunt}
                placeholder="Investigation context and objective…"
                className="min-h-[140px] w-full resize-y rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
              />
            </Card>

            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-lg font-semibold text-foreground">
                  Conclusion
                </div>
                <div className="text-xs text-muted-foreground">
                  {conclusionSaving ? "Saving…" : conclusionSavedAt ? "Saved" : ""}
                </div>
              </div>

              <textarea
                value={editConclusion}
                onChange={(e) => setEditConclusion(e.target.value)}
                onBlur={() => {
                  if (conclusionSaveTimerRef.current) {
                    window.clearTimeout(conclusionSaveTimerRef.current);
                  }

                  void autosaveConclusion(editConclusion);
                }}
                disabled={busy || !canManageHunt}
                placeholder="Final conclusion…"
                className="min-h-[140px] w-full resize-y rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
              />
            </Card>

            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-lg font-semibold text-foreground">
                  Linked cases
                </div>
                <div className="text-xs text-muted-foreground">{caseLinks.length}</div>
              </div>

              {caseLinks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-8 text-center">
                  <div className="text-sm font-medium text-foreground">
                    No linked case
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {caseLinks
                    .slice()
                    .reverse()
                    .map((link) => (
                      <div
                        key={link.id}
                        className="flex items-center justify-between rounded-2xl border border-border bg-background/50 p-3"
                      >
                        <div className="min-w-0">
                          <Link
                            to={`/cases/${link.case?.id}`}
                            className="block truncate text-sm font-medium text-foreground underline"
                          >
                            {link.case?.case_number ? `#${link.case.case_number} — ` : ""}
                            {link.case?.title}
                          </Link>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {link.link_type} • {formatDate(link.created_at)}
                          </div>
                        </div>

                        <DeleteButton
                          type="button"
                          disabled={busy || !canManageHunt}
                          onClick={() => void removeCaseLink(link.id)}
                          title="Remove link"
                        />
                      </div>
                    ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "iocs" ? (
        <Card className="p-5">
          <KeyValueEditor
            title="IoCs"
            rows={hunt.iocs || []}
            disabled={busy || !canManageHunt}
            showStatus
            statusOptions={IOC_STATUS_OPTIONS}
            onChange={async (next) => {
              await patchHunt({ iocs: next } as any);
            }}
          />
        </Card>
      ) : null}

      {tab === "assets" ? (
        <Card className="p-5">
          <KeyValueEditor
            title="Assets"
            rows={hunt.assets || []}
            disabled={busy || !canManageHunt}
            showStatus
            statusOptions={ASSET_STATUS_OPTIONS}
            onChange={async (next) => {
              await patchHunt({ assets: next } as any);
            }}
          />
        </Card>
      ) : null}

      {tab === "timeline" ? (
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-lg font-semibold text-foreground">
              Hunt timeline
            </div>
            <div className="text-xs text-muted-foreground">{timeline.length}</div>
          </div>

          {timeline.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-8 text-center">
              <div className="text-sm font-medium text-foreground">
                No timeline item yet
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {timeline.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-border bg-background/50 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">
                        {item.title}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatDate(item.occurred_at)}
                        {item.author_username ? ` • ${item.author_username}` : ""}
                      </div>
                    </div>
                    <div className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
                      {item.kind}
                    </div>
                  </div>

                  <MarkdownRenderedContent
                    markdown={String(item.details || "—")}
                    className="prose prose-sm mt-3 max-w-none text-foreground dark:prose-invert"
                  />

                  {item.case_id ? (
                    <div className="mt-3 text-xs">
                      <Link
                        to={`/cases/${item.case_id}`}
                        className="text-foreground underline"
                      >
                        {item.case_number
                          ? `Case #${item.case_number}`
                          : "Open linked case"}{" "}
                        — {item.case_title}
                      </Link>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {createCaseOpen
        ? createPortal(
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <button
                type="button"
                className="absolute inset-0 m-0 appearance-none rounded-none border-0 bg-slate-950/40 p-0 outline-none backdrop-blur-[3px]"
                onClick={() => {
                  if (createCaseBusy) return;
                  setCreateCaseOpen(false);
                  setCaseSourceEntry(null);
                }}
                aria-label="Close create case dialog"
              />

              <div className="relative max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-3xl border border-border bg-card shadow-panel">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div>
                    <div className="text-lg font-semibold text-foreground">
                      Create case from escalation
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      The new case description will reuse the selected escalation note.
                    </div>
                  </div>

                  <CancelButton
                    type="button"
                    onClick={() => {
                      setCreateCaseOpen(false);
                      setCaseSourceEntry(null);
                    }}
                    disabled={createCaseBusy}
                    title="Close"
                  />
                </div>

                <div className="grid gap-6 overflow-y-auto p-5 lg:grid-cols-2">
                  <div className="space-y-4">
                    <label className="block">
                      <div className="mb-1.5 text-sm font-medium text-foreground">
                        Case title
                      </div>
                      <input
                        className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                        value={newCaseTitle}
                        onChange={(e) => setNewCaseTitle(e.target.value)}
                        disabled={createCaseBusy}
                      />
                    </label>

                    <div className="rounded-2xl border border-border bg-background/50 p-4">
                      <div className="mb-2 text-sm font-semibold text-foreground">
                        Escalation note
                      </div>
                      <MarkdownRenderedContent
                        markdown={String(caseSourceEntry?.text || "—")}
                        className="max-w-none text-foreground"
                      />
                    </div>

                    <div className="rounded-2xl border border-border bg-background/50 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-sm font-semibold text-foreground">IoCs</div>
                        <button
                          type="button"
                          className="text-xs border-none bg-transparent cursor-pointer text-muted-foreground underline"
                          onClick={() => {
                            const next: Record<string, boolean> = {};
                            huntIocs.forEach((row: any, index: number) => {
                              next[rowKey(row, index)] = true;
                            });
                            setSelectedIocKeys(next);
                          }}
                        >
                          Select all
                        </button>
                      </div>

                      <div className="space-y-2">
                        {huntIocs.length === 0 ? (
                          <div className="text-sm text-muted-foreground">No IoC.</div>
                        ) : (
                          huntIocs.map((row: any, index: number) => {
                            const k = rowKey(row, index);
                            return (
                              <label
                                key={k}
                                className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3"
                              >
                                <input
                                  type="checkbox"
                                  checked={!!selectedIocKeys[k]}
                                  onChange={(e) =>
                                    setSelectedIocKeys((prev) => ({
                                      ...prev,
                                      [k]: e.target.checked,
                                    }))
                                  }
                                />
                                <div className="min-w-0 text-sm">
                                  <div className="font-medium text-foreground">
                                    {row.field || "IoC"}
                                  </div>
                                  <div className="break-words text-muted-foreground">
                                    {row.value || "—"}
                                  </div>
                                </div>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-2xl border border-border bg-background/50 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-sm font-semibold text-foreground">
                          Assets
                        </div>
                        <button
                          type="button"
                          className="text-xs border-none bg-transparent cursor-pointer text-muted-foreground underline"
                          onClick={() => {
                            const next: Record<string, boolean> = {};
                            huntAssets.forEach((row: any, index: number) => {
                              next[rowKey(row, index)] = true;
                            });
                            setSelectedAssetKeys(next);
                          }}
                        >
                          Select all
                        </button>
                      </div>

                      <div className="space-y-2">
                        {huntAssets.length === 0 ? (
                          <div className="text-sm text-muted-foreground">No asset.</div>
                        ) : (
                          huntAssets.map((row: any, index: number) => {
                            const k = rowKey(row, index);
                            return (
                              <label
                                key={k}
                                className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3"
                              >
                                <input
                                  type="checkbox"
                                  checked={!!selectedAssetKeys[k]}
                                  onChange={(e) =>
                                    setSelectedAssetKeys((prev) => ({
                                      ...prev,
                                      [k]: e.target.checked,
                                    }))
                                  }
                                />
                                <div className="min-w-0 text-sm">
                                  <div className="font-medium text-foreground">
                                    {row.field || "Asset"}
                                  </div>
                                  <div className="break-words text-muted-foreground">
                                    {row.value || "—"}
                                  </div>
                                </div>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
                  <CancelButton
                    type="button"
                    onClick={() => {
                      setCreateCaseOpen(false);
                      setCaseSourceEntry(null);
                    }}
                    disabled={createCaseBusy}
                    title="Cancel"
                  />

                  <NewGenButton
                    type="button"
                    onClick={() => void handleCreateCaseFromEscalation()}
                    disabled={createCaseBusy || !canCreateCaseFromHunt || !newCaseTitle.trim()}
                    title="Create case"
                  />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete hunt"
        confirmTag="delete"
        message="This hunt will be deleted."
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}