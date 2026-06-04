import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  addComment,
  deleteAttachment,
  deleteComment,
  fetchEventDetail,
  getCaseWorkbook,
  listAttachments,
  listComments,
  listLinkedAlerts,
  listLinkedTasks,
  markCaseViewed,
  patchWorkbookItem,
  type Attachment,
  type Comment,
  type EventDetail,
  type LinkedTask,
  unmergeAlert,
  updateComment,
  updateEventStatus,
  uploadAttachment,
} from "../api/caseDetail";
import { archiveCase, deleteCase, unarchiveCase, updateTicket } from "../api/cases";
import { useToast } from "../components/ui/toast";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { fetchUsersLite, type UserLite } from "../api/usersLite";
import { useMe } from "../contexts/MeContext";
import { listCustomers, type Customer } from "../api/settingsCustomers";
import { applyCaseWorkbookTemplate, type WorkbookInstance } from "../api/caseDetail";
import { listWorkbookTemplates, type WorkbookTemplate } from "../api/settingsWorkbooks";
import { listClassifications, listSeverities, type ClassificationItem, type SeverityItem } from "../api/dataModels";
import { listReportTemplates } from "../api/settingsReports";
import IncidentTimeline from "../components/incident/IncidentTimeline";
import ConnectorRunnerDrawer from "../components/connectors/ConnectorRunnerDrawer";
import { listConnectorInstances, listConnectorResults, type ConnectorInstance, type ConnectorTarget, type ConnectorTargetType } from "../api/connectors";
import { createCaseExchange, deleteCaseExchange, listCaseExchanges, sendCaseExchange, configureCaseExchangeFollowups, type CaseExchange, updateCaseExchange } from "../api/exchanges";
import { listCaseExchangeQuickparts, type CaseExchangeQuickpart } from "../api/settingsCaseExchange";
import CaseActivityTab from "../components/cases/detail/CaseActivityTab";
import CaseExchangesTab from "../components/cases/detail/CaseExchangesTab";
import CaseHeader from "../components/cases/detail/CaseHeader";
import CaseHistoryDrawer from "../components/cases/detail/CaseHistoryDrawer";
import CaseIndicatorsTab from "../components/cases/detail/CaseIndicatorsTab";
import CaseSummaryTab from "../components/cases/detail/CaseSummaryTab";
import type { EnrichmentLite, KVRow, Tab } from "../components/cases/detail/types";
import { buildHistoryIndex, getHistoryBundle, isRichTextEmpty, joinCsv, normalizeSubjectForReply, parseCsv, rowId, uniqKeepOrder } from "../components/cases/detail/utils";
import { LeftButton } from "../components/ui/IconButton";


export default function TicketDetail() {
  const [users, setUsers] = useState<UserLite[]>([]);
  useEffect(() => {
    fetchUsersLite().then(setUsers).catch(() => setUsers([]));
  }, []);

  const { id } = useParams();
  const ticketId = id || "";
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [commentBusyId, setCommentBusyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const { push } = useToast();
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "comment" | "attachment"; id: string } | null>(null);
  const [activityLimit] = useState(10);
  const timeline = useMemo(() => event?.timeline_items ?? [], [event]);
  const [busyCaseId, setBusyCaseId] = useState<string | null>(null);
  const [linkedAlerts, setLinkedAlerts] = useState<any[]>([]);
  const [linkedTasks, setLinkedTasks] = useState<LinkedTask[]>([]);
  const [confirmUnmerge, setConfirmUnmerge] = useState<{ id: string; title: string } | null>(null);
  const [confirmDeleteCase, setConfirmDeleteCase] = useState(false);
  const navigate = useNavigate();
  const editableRef = useRef<HTMLDivElement>(null);

  const [autoFollowupAction, setAutoFollowupAction] = useState<"save" | "send">("save");
  const [autoFollowupEnabled, setAutoFollowupEnabled] = useState(false);
  const [autoFollowupDelayValue, setAutoFollowupDelayValue] = useState("24");
  const [autoFollowupDelayUnit, setAutoFollowupDelayUnit] = useState<
    "minute" | "hour" | "day" | "week" | "month"
  >("hour");
  const [autoFollowupQuickpartId, setAutoFollowupQuickpartId] = useState("");
  const [followupSelectionOpen, setFollowupSelectionOpen] = useState(false);
  const [followupSelectionAction, setFollowupSelectionAction] = useState<"save" | "send">("save");

  useEffect(() => {
    if (!ticketId) return;

    markCaseViewed(ticketId).catch(() => {});
  }, [ticketId]);
  
  const [autoFollowupOpen, setAutoFollowupOpen] = useState(false);
  useEffect(() => {
    setAutoFollowupEnabled(!!event?.auto_followup_enabled);
    setAutoFollowupDelayValue(String(event?.auto_followup_delay_value ?? 24));
    setAutoFollowupDelayUnit(
      (event?.auto_followup_delay_unit as
        | "minute"
        | "hour"
        | "day"
        | "week"
        | "month"
        | undefined) ?? "hour"
    );
    setAutoFollowupAction(
      ((event as any)?.auto_followup_action as "save" | "send" | undefined) ?? "save"
    );
    setAutoFollowupQuickpartId(String(event?.auto_followup_quickpart_id ?? ""));
  }, [
    event?.auto_followup_enabled,
    event?.auto_followup_delay_value,
    event?.auto_followup_delay_unit,
    event?.auto_followup_quickpart_id,
  ]);

  const me = useMe();
  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canUnmerge = can("alert.unmerge");
  const canDeleteCase = can("case.delete");
  const canUpdateCase = can("case.update");
  const canViewTasks = can("task.view") || can("task.manage");

  const refreshSeq = useRef(0);
  const [tab, setTab] = useState<Tab>("summary");
  const location = useLocation();

  useEffect(() => {
    sessionStorage.setItem(`doko:chat:tab:${location.pathname}`, tab);
  }, [location.pathname, tab]);

  useEffect(() => {
    if (tab !== "summary") return;
    setEditTitle(event?.title ?? "");
    if (!descFocusedRef.current) setEditDescription(event?.description ?? "");
  }, [tab, event?.title, event?.description]);

  const [customers, setCustomers] = useState<Customer[]>([]);
  useEffect(() => {
    listCustomers({ include_inactive: false }).then((r) => setCustomers(r.results ?? [])).catch(() => setCustomers([]));
  }, []);

  const descFocusedRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const saveQueuedRef = useRef(false);

  const [workbook, setWorkbook] = useState<WorkbookInstance | null>(null);
  const [wbTemplates, setWbTemplates] = useState<WorkbookTemplate[]>([]);
  const [wbLoading, setWbLoading] = useState(false);
  const [wbBusyItemId, setWbBusyItemId] = useState<string | null>(null);
  const [wbBusyApply, setWbBusyApply] = useState(false);

  async function loadWorkbook() {
    if (!ticketId) return;
    setWbLoading(true);
    try {
      setWorkbook(await getCaseWorkbook(ticketId));
    } catch {
      setWorkbook(null);
    } finally {
      setWbLoading(false);
    }
  }

  useEffect(() => {
    listWorkbookTemplates({ include_inactive: false })
      .then((r: any) => setWbTemplates((r?.results ?? []).filter((x: any) => x.is_active)))
      .catch(() => setWbTemplates([]));
  }, []);


  async function saveAutoFollowupSettings() {
    if (!canUpdateCase) return;
    if (!ticketId) return;

    const parsedDelay = Number(autoFollowupDelayValue);
    const nextDelay =
      Number.isFinite(parsedDelay) && parsedDelay > 0
        ? Math.max(1, Math.floor(parsedDelay))
        : 24;

    try {
      setBusy(true);
      await updateTicket(ticketId, {
        auto_followup_enabled: autoFollowupEnabled,
        auto_followup_delay_value: nextDelay,
        auto_followup_delay_unit: autoFollowupDelayUnit,
        auto_followup_quickpart_id: autoFollowupQuickpartId || null,
        auto_followup_action: autoFollowupAction,
      } as any);
      push({ kind: "success", title: "Automatic follow-up settings saved" });
      await refreshAll();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onApplyWorkbookTemplate(nextTemplateId: string | null) {
    if (!canUpdateCase) return;
    if (!ticketId) return;
    setWbBusyApply(true);
    try {
      await applyCaseWorkbookTemplate(ticketId, nextTemplateId);
      push({ kind: "success", title: nextTemplateId ? "Workbook applied" : "Workbook cleared" });
      await refreshAll();
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
    } finally {
      setWbBusyApply(false);
    }
  }

  async function onToggleWorkbookItem(itemId: string, nextDone: boolean) {
    if (!canUpdateCase) return;
    setWbBusyItemId(itemId);
    try {
      await patchWorkbookItem(itemId, { is_done: nextDone });
      await refreshAll();
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
    } finally {
      setWbBusyItemId(null);
    }
  }

  async function refreshAll() {
    if (!ticketId) return;
    const seq = ++refreshSeq.current;
    setError(null);

    const e = await fetchEventDetail(ticketId);
    if (seq !== refreshSeq.current) return;
    setEvent(e);
    setEditTitle(e.title);
    if (!(tab === "summary" && descFocusedRef.current)) setEditDescription(e.description || "");

    const [c, a, al, lt] = await Promise.all([
      listComments(ticketId),
      listAttachments(ticketId),
      listLinkedAlerts(ticketId),
      canViewTasks ? listLinkedTasks(ticketId).catch(() => []) : Promise.resolve([]),
    ]);

    if (seq !== refreshSeq.current) return;
    setComments(c);
    setAttachments(a);
    setLinkedAlerts(al);
    setLinkedTasks(lt);
    await loadWorkbook();
  }

  const [exchanges, setExchanges] = useState<CaseExchange[]>([]);
  const [exchangesBusy, setExchangesBusy] = useState(false);
  const [exchangeView, setExchangeView] = useState<CaseExchange | null>(null);
  const [exchangeViewDraft, setExchangeViewDraft] = useState({ channel: "", sender: "", to: "", cc: "", bcc: "", subject: "", body: "", message_id: "", references: "" });
  const [exchangeCreateOpen, setExchangeCreateOpen] = useState(false);
  const [exchangeDraft, setExchangeDraft] = useState({ direction: "inbound" as "inbound" | "outbound", channel: "email" as "email" | "other", sender: "", to: "", cc: "", bcc: "", subject: "", body: "", message_id: "", references: "" });
  const [replyTo, setReplyTo] = useState<CaseExchange | null>(null);

  function openAddExchange() {
    setReplyTo(null);
    setExchangeDraft({ direction: "outbound", channel: "email", sender: "", to: "", cc: "", bcc: "", subject: "", body: "", message_id: "", references: "" });
    setSelectedQuickpartId("");
    void refreshQuickparts();
    setExchangeCreateOpen(true);
  }

  const [selectedExchangeIds, setSelectedExchangeIds] = useState<Record<string, boolean>>({});
  function toggleSelectExchange(id: string) {
    setSelectedExchangeIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function openDetails(x: CaseExchange) {
    setExchangeView(x);
    setExchangeViewDraft({
      channel: String(x.channel || ""),
      sender: String(x.sender || ""),
      to: joinCsv((x as any).to),
      cc: joinCsv((x as any).cc),
      bcc: joinCsv((x as any).bcc),
      subject: String(x.subject || ""),
      body: String(x.body || ""),
      message_id: String((x as any).message_id || ""),
      references: joinCsv((x as any).references),
    });
  }

  const [replyModalOpen, setReplyModalOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<CaseExchange | null>(null);
  const [replyQueue, setReplyQueue] = useState<CaseExchange[]>([]);
  const [replyQueueIdx, setReplyQueueIdx] = useState(0);

  function buildReferencesForReply(x: CaseExchange) {
    const parentMsgId = String((x as any).message_id || "").trim();
    const parentRefs = Array.isArray((x as any).references) ? (x as any).references : [];
    const out: string[] = [];
    for (const r of parentRefs) {
      const v = String(r || "").trim();
      if (v && !out.includes(v)) out.push(v);
    }
    if (parentMsgId && !out.includes(parentMsgId)) out.push(parentMsgId);
    return out;
  }

  function openReplyModal(x: CaseExchange) {
    setReplyTarget(x);
    const refs = buildReferencesForReply(x);
    setExchangeDraft({
      direction: "outbound",
      channel: (x.channel as any) || "email",
      sender: "",
      to: String(x.sender || "").trim(),
      cc: "",
      bcc: "",
      subject: normalizeSubjectForReply(String(x.subject || "")),
      body: "",
      message_id: "",
      references: refs.join(", "),
    });
    setSelectedQuickpartId("");
    void refreshQuickparts();
    setReplyModalOpen(true);
  }

  function closeReplyModal() {
    setReplyModalOpen(false);
    setReplyTarget(null);
    if (replyQueue.length > 0) {
      const nextIdx = replyQueueIdx + 1;
      if (nextIdx < replyQueue.length) {
        setReplyQueueIdx(nextIdx);
        openReplyModal(replyQueue[nextIdx]);
      } else {
        setReplyQueue([]);
        setReplyQueueIdx(0);
      }
    }
  }

  async function saveReplyDraftToConversationOnly() {
    if (!canUpdateCase) return;
    if (!ticketId) return;
    setExchangesBusy(true);
    try {
      await createCaseExchange(ticketId, {
        direction: exchangeDraft.direction,
        channel: exchangeDraft.channel as any,
        sender: exchangeDraft.sender.trim(),
        to: parseCsv(exchangeDraft.to),
        cc: parseCsv(exchangeDraft.cc),
        bcc: parseCsv(exchangeDraft.bcc),
        subject: exchangeDraft.subject.trim(),
        body: exchangeDraft.body,
        message_id: exchangeDraft.message_id.trim(),
        references: parseCsv(exchangeDraft.references),
        raw: {
          in_reply_to: String(replyTarget?.message_id || "").trim(),
        },
      } as any);
      push({ kind: "success", title: "Exchange added" });
      await refreshExchanges();
      closeReplyModal();
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
    } finally {
      setExchangesBusy(false);
    }
  }

  async function bulkDeleteSelected() {
    if (!canUpdateCase) return;
    const ids = Object.entries(selectedExchangeIds || {}).filter(([, v]) => !!v).map(([k]) => k);
    if (!ids.length) return;
    setExchangesBusy(true);
    try {
      for (const exId of ids) await deleteCaseExchange(exId);
      push({ kind: "success", title: "Deleted" });
      setSelectedExchangeIds({});
      await refreshExchanges();
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
      await refreshExchanges();
    } finally {
      setExchangesBusy(false);
    }
  }

  const [bulkReplyOpen, setBulkReplyOpen] = useState(false);
  const [bulkReplyTargets, setBulkReplyTargets] = useState<CaseExchange[]>([]);
  const bulkRecipients = useMemo(() => uniqKeepOrder((bulkReplyTargets || []).map((x) => String((x as any)?.sender || "").trim()).filter(Boolean)), [bulkReplyTargets]);
  const [bulkReplyDraft, setBulkReplyDraft] = useState({ direction: "outbound" as const, channel: "email" as CaseExchange["channel"], sender: "", cc: "", bcc: "", subject: "", body: "", message_id: "" });

  function openBulkReplyModal() {
    const ids = Object.entries(selectedExchangeIds || {}).filter(([, v]) => !!v).map(([k]) => k);
    if (!ids.length) return;
    const mapById = new Map(exchanges.map((x) => [x.id, x]));
    const targets = ids.map((entryId) => mapById.get(entryId)).filter(Boolean) as CaseExchange[];
    targets.sort((a, b) => (Date.parse(String(a.created_at)) || 0) - (Date.parse(String(b.created_at)) || 0));
    setBulkReplyTargets(targets);
    const first = targets[0];
    setBulkReplyDraft({ direction: "outbound", channel: ((first?.channel as any) || "email") as any, sender: "", cc: "", bcc: "", subject: "", body: "", message_id: "" });
    setBulkReplyOpen(true);
  }

  async function saveBulkReplyConversationOnly() {
    if (!canUpdateCase) return;
    if (!ticketId || !bulkReplyTargets.length) return;
    setExchangesBusy(true);
    try {
      const enteredSubject = String(bulkReplyDraft.subject || "").trim();
      const enteredBody = String(bulkReplyDraft.body || "");
      for (const x of bulkReplyTargets) {
        const subject = enteredSubject || normalizeSubjectForReply(String(x.subject || ""));
        const refs = buildReferencesForReply(x);
        await createCaseExchange(ticketId, {
          direction: "outbound",
          channel: bulkReplyDraft.channel,
          sender: String(bulkReplyDraft.sender || "").trim(),
          to: [String(x.sender || "").trim()].filter(Boolean),
          cc: parseCsv(bulkReplyDraft.cc),
          bcc: parseCsv(bulkReplyDraft.bcc),
          subject,
          body: enteredBody,
          message_id: String(bulkReplyDraft.message_id || "").trim(),
          references: refs,
          raw: {
            in_reply_to: String(x.message_id || "").trim(),
          },
        } as any);
      }
      push({ kind: "success", title: "Replies sent to conversation" });
      setBulkReplyOpen(false);
      setBulkReplyTargets([]);
      setSelectedExchangeIds({});
      await refreshExchanges();
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
      await refreshExchanges();
    } finally {
      setExchangesBusy(false);
    }
  }

  async function sendBulkReplyIndividually() {
    if (!canUpdateCase || !ticketId) return;

    if (!bulkReplyTargets.length) return;

    setExchangesBusy(true);

    try {
      for (const target of bulkReplyTargets) {
        const subject =
          bulkReplyDraft.subject?.trim() ||
          normalizeSubjectForReply(String(target.subject || ""));

        const refs = buildReferencesForReply(target);

        const payload: Partial<CaseExchange> = {
          direction: "outbound" as const,
          channel: bulkReplyDraft.channel,
          sender: bulkReplyDraft.sender.trim(),
          to: [String(target.sender || "").trim()].filter(Boolean),
          cc: parseCsv(bulkReplyDraft.cc),
          bcc: parseCsv(bulkReplyDraft.bcc),
          subject,
          body: bulkReplyDraft.body,
          message_id: bulkReplyDraft.message_id.trim(),
          references: refs,
          raw: {
            in_reply_to: String(target.message_id || "").trim(),
          },
        };

        await sendCaseExchange(ticketId, payload);
      }

      push({ kind: "success", title: "Messages sent" });

      setBulkReplyOpen(false);

      setBulkReplyDraft({
        direction: "outbound",
        channel: "email",
        sender: "",
        cc: "",
        bcc: "",
        subject: "",
        body: "",
        message_id: "",
      });

      await refreshExchanges();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Send failed",
        message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network"),
      });
    } finally {
      setExchangesBusy(false);
    }
  }

  const [quickparts, setQuickparts] = useState<CaseExchangeQuickpart[]>([]);
  const [quickpartsBusy, setQuickpartsBusy] = useState(false);
  const [selectedQuickpartId, setSelectedQuickpartId] = useState<string>("");

  async function refreshQuickparts() {
    setQuickpartsBusy(true);
    try {
      const r = await listCaseExchangeQuickparts({ q: "" });
      const items = Array.isArray(r) ? r : (r?.results ?? []);
      setQuickparts(items.filter((x: any) => x?.is_active !== false));
    } catch {
      setQuickparts([]);
    } finally {
      setQuickpartsBusy(false);
    }
  }

  useEffect(() => {
    void refreshQuickparts();
  }, []);

  function applyQuickpartToBody(id: string) {
    setSelectedQuickpartId(id);
    const qp = quickparts.find((x) => x.id === id);
    if (!qp) return;
    setExchangeDraft((p) => ({ ...p, body: qp.body || "" }));
  }

  async function refreshExchanges() {
    if (!ticketId) return;
    setExchangesBusy(true);
    try {
      const r = await listCaseExchanges(ticketId);
      setExchanges(Array.isArray(r) ? r : []);
    } catch (e: any) {
      setExchanges([]);
      push({ kind: "error", title: "Error", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
    } finally {
      setExchangesBusy(false);
    }
  }

  async function onCreateExchange() {
    if (!canUpdateCase) return;
    if (!ticketId) return;
    setExchangesBusy(true);
    try {
      await createCaseExchange(ticketId, {
        direction: exchangeDraft.direction,
        channel: exchangeDraft.channel,
        sender: exchangeDraft.sender.trim(),
        to: parseCsv(exchangeDraft.to),
        cc: parseCsv(exchangeDraft.cc),
        bcc: parseCsv(exchangeDraft.bcc),
        subject: exchangeDraft.subject.trim(),
        body: exchangeDraft.body,
        message_id: exchangeDraft.message_id.trim(),
        references: parseCsv(exchangeDraft.references),
        raw: {},
      });
      push({ kind: "success", title: "Exchange added" });
      setExchangeCreateOpen(false);
      setExchangeDraft({ direction: "inbound", channel: "email", sender: "", to: "", cc: "", bcc: "", subject: "", body: "", message_id: "", references: "" });
      await refreshExchanges();
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
    } finally {
      setExchangesBusy(false);
    }
  }

  async function onSendExchange() {
    if (!canUpdateCase || !ticketId) return;
    setExchangesBusy(true);
    try {
      await sendCaseExchange(ticketId, {
        direction: "outbound",
        channel: exchangeDraft.channel,
        sender: exchangeDraft.sender.trim(),
        to: parseCsv(exchangeDraft.to),
        cc: parseCsv(exchangeDraft.cc),
        bcc: parseCsv(exchangeDraft.bcc),
        subject: exchangeDraft.subject.trim(),
        body: exchangeDraft.body,
        message_id: exchangeDraft.message_id.trim(),
        references: parseCsv(exchangeDraft.references),
        raw: {
          in_reply_to: String(replyTarget?.message_id || "").trim(),
        },
      });

      push({ kind: "success", title: "Message sent" });
      setExchangeCreateOpen(false);
      setReplyTarget(null);
      setExchangeDraft({ direction: "inbound", channel: "email", sender: "", to: "", cc: "", bcc: "", subject: "", body: "", message_id: "", references: "" });
      await refreshExchanges();
    } catch (e: any) {
      push({ kind: "error", title: "Send failed", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
    } finally {
      setExchangesBusy(false);
    }
  }

  async function configureSelectedFollowups() {
    if (!canUpdateCase || !ticketId) return;

    const ids = Object.entries(selectedExchangeIds || {})
      .filter(([, v]) => !!v)
      .map(([k]) => k);

    if (!ids.length) return;

    if (!autoFollowupQuickpartId) {
      push({
        kind: "error",
        title: "Quickpart required",
        message: "Select a quickpart before enabling follow-up.",
      });
      return;
    }

    const parsedDelay = Number(autoFollowupDelayValue);
    const nextDelay =
      Number.isFinite(parsedDelay) && parsedDelay > 0
        ? Math.max(1, Math.floor(parsedDelay))
        : 24;

    setExchangesBusy(true);
    try {
      await configureCaseExchangeFollowups(ticketId, {
        exchange_ids: ids,
        enabled: true,
        delay_value: nextDelay,
        delay_unit: autoFollowupDelayUnit,
        quickpart_id: autoFollowupQuickpartId,
        action: followupSelectionAction,
      });

      push({ kind: "success", title: "Follow-up enabled" });
      setFollowupSelectionOpen(false);
      setSelectedExchangeIds({});
      await refreshExchanges();
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
    } finally {
      setExchangesBusy(false);
    }
  }

  async function disableSelectedFollowups() {
    if (!canUpdateCase || !ticketId) return;

    const ids = Object.entries(selectedExchangeIds || {})
      .filter(([, v]) => !!v)
      .map(([k]) => k);

    if (!ids.length) return;

    setExchangesBusy(true);
    try {
      await configureCaseExchangeFollowups(ticketId, {
        exchange_ids: ids,
        enabled: false,
        delay_value: 24,
        delay_unit: "hour",
        quickpart_id: null,
        action: "save",
      });

      push({ kind: "success", title: "Follow-up disabled" });
      setSelectedExchangeIds({});
      await refreshExchanges();
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network"),
      });
    } finally {
      setExchangesBusy(false);
    }
  }  


  useEffect(() => {
    if (tab !== "exchanges" || !ticketId) return;

    void refreshExchanges();

    const interval = window.setInterval(() => {
      void refreshExchanges();
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [tab, ticketId]);

  
  async function saveIfDirty(description?: string) {
    if (!canUpdateCase) return;
    if (!ticketId || !event) return;
    if (saveInFlightRef.current) {
      saveQueuedRef.current = true;
      return;
    }
    const nextTitle = editTitle.trim();
    const nextDesc = description ?? editDescription ?? "";
    if (!nextTitle) {
      setEditTitle(event.title);
      return;
    }
    if (nextTitle === (event.title ?? "") && nextDesc === (event.description ?? "")) return;
    saveInFlightRef.current = true;
    setBusy(true);
    try {
      await updateTicket(ticketId, { title: nextTitle, description: nextDesc } as any);
      setEvent((prev) => (prev ? ({ ...prev, title: nextTitle, description: nextDesc } as any) : prev));
      setEditTitle(nextTitle);
      setEditDescription(nextDesc);
      push({ kind: "success", title: "Saved" });
      await refreshAll();
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.status ?? "network") });
    } finally {
      saveInFlightRef.current = false;
      setBusy(false);
      if (saveQueuedRef.current) {
        saveQueuedRef.current = false;
        void saveIfDirty(nextDesc);
      }
    }
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await refreshAll();
      } catch (e: any) {
        const msg = e?.response?.status ? `API error (${e.response.status})` : "Network error";
        if (mounted) setError(msg);
        if (e?.response?.status === 404) {
          push({ kind: "info", title: "Case not found", message: "It may have been deleted." });
          navigate("/cases");
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [ticketId]);


  useEffect(() => {
    if (!ticketId || !canViewTasks) return;
    void refreshAll();
  }, [ticketId, canViewTasks]);

  
  useEffect(() => {
    function onChatPosted(e: Event) {
      const detail = (e as CustomEvent<{
        pageType?: string;
        objectId?: string;
      }>).detail;

      if (!detail) return;
      if (detail.pageType !== "case") return;
      if (String(detail.objectId || "") !== ticketId) return;

      void refreshAll();
    }

    window.addEventListener("doko:chat-posted", onChatPosted as EventListener);
    return () => {
      window.removeEventListener("doko:chat-posted", onChatPosted as EventListener);
    };
  }, [ticketId]);


  useEffect(() => {
    if (!editableRef.current) return;
    if (editableRef.current.textContent !== editTitle) editableRef.current.textContent = editTitle;
  }, [editTitle]);

  const isArchived = !!(event as any)?.archived_at;
  async function toggleArchive() {
    if (!canUpdateCase) return;
    if (!ticketId || busy || archiveBusy) return;
    setArchiveBusy(true);
    try {
      if (isArchived) {
        await unarchiveCase(ticketId);
        push({ kind: "success", title: "Case unarchived" });
      } else {
        await archiveCase(ticketId);
        push({ kind: "success", title: "Case archived" });
      }
      await refreshAll();
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
    } finally {
      setArchiveBusy(false);
    }
  }

  async function changeStatus(next: string) {
    if (!canUpdateCase) return;
    if (!ticketId) return;
    setBusy(true);
    try {
      await updateEventStatus(ticketId, next);
      push({ kind: "success", title: "Status updated" });
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function submitComment() {
    if (!canUpdateCase) return;
    if (!ticketId || isRichTextEmpty(commentText)) return;
    setBusy(true);
    try {
      await addComment(ticketId, commentText);
      push({ kind: "success", title: "Comment added" });
      setCommentText("");
      await refreshAll();
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
    } finally {
      setBusy(false);
    }
  }

  function removeComment(commentId: string) {
    if (!canUpdateCase) return;
    setConfirm({ kind: "comment", id: commentId });
  }
  function startEditComment(c: Comment) {
    setEditingCommentId(c.id);
    setEditingText(String((c as any).text ?? ""));
  }
  function cancelEditComment() {
    setEditingCommentId(null);
    setEditingText("");
  }
  async function saveEditComment(commentId: string, text?: string) {
    if (!canUpdateCase) return;

    const nextText = text ?? editingText;

    if (!ticketId || isRichTextEmpty(nextText)) return;

    setCommentBusyId(commentId);

    try {
      await updateComment(commentId, nextText);
      push({ kind: "success", title: "Comment updated" });
      setComments((prev) => prev.map((c) => (c.id === commentId ? ({ ...c, text: nextText } as any) : c)));
      cancelEditComment();
      await refreshAll();
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
    } finally {
      setCommentBusyId(null);
    }
  }

  async function onUploadFile(file: File) {
    if (!canUpdateCase) return;
    if (!ticketId) return;
    if (file.size > 50 * 1024 * 1024) {
      push({
        kind: "error",
        title: "File too large",
        message: "Attachment must be smaller than 50 MB.",
      });
      return;
    }
    setBusy(true);
    try {
      await uploadAttachment(ticketId, file);
      push({ kind: "success", title: "File uploaded" });
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }
  function removeAttachment(attachmentId: string) {
    if (!canUpdateCase) return;
    setConfirm({ kind: "attachment", id: attachmentId });
  }

  const [sevOptions, setSevOptions] = useState<SeverityItem[]>([]);
  const [clsOptions, setClsOptions] = useState<ClassificationItem[]>([]);
  useEffect(() => {
    let mounted = true;
    Promise.all([listSeverities(false), listClassifications(false)])
      .then(([s, c]) => {
        if (!mounted) return;
        setSevOptions((s ?? []).filter((x) => x.is_active));
        setClsOptions((c ?? []).filter((x) => x.is_active));
      })
      .catch(() => {
        if (!mounted) return;
        setSevOptions([]);
        setClsOptions([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function changeSeverity(nextCode: string) {
    if (!canUpdateCase) return;
    if (!ticketId || !nextCode) return;
    setBusy(true);
    try {
      await updateTicket(ticketId, { severity: nextCode } as any);
      push({ kind: "success", title: "Severity updated" });
      await refreshAll();
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
    } finally {
      setBusy(false);
    }
  }

  async function changeClassification(nextCode: string) {
    if (!canUpdateCase) return;
    if (!ticketId || !nextCode) return;
    setBusy(true);
    try {
      await updateTicket(ticketId, { classification: nextCode } as any);
      push({ kind: "success", title: "Classification updated" });
      await refreshAll();
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
    } finally {
      setBusy(false);
    }
  }

  async function changeOutcome(nextCode: string) {
    if (!canUpdateCase) return;
    if (!ticketId || !nextCode) return;
    setBusy(true);
    try {
      await updateTicket(ticketId, { outcome: nextCode } as any);
      push({ kind: "success", title: "Outcome updated" });
      await refreshAll();
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
    } finally {
      setBusy(false);
    }
  }

  const [reportTemplates, setReportTemplates] = useState<{ id: string; name: string; is_active: boolean; version: number }[]>([]);
  const [reportTplId, setReportTplId] = useState<string>("");
  const [reportBusy, setReportBusy] = useState(false);
  useEffect(() => {
    listReportTemplates({ include_inactive: false }).then((r) => setReportTemplates((r.results ?? []).filter((x: any) => x.is_active))).catch(() => setReportTemplates([]));
  }, []);

  const [instances, setInstances] = useState<ConnectorInstance[]>([]);
  const [instancesBusy, setInstancesBusy] = useState(false);
  async function loadConnectorInstances() {
    setInstancesBusy(true);
    try {
      const r = await listConnectorInstances();
      setInstances(Array.isArray(r) ? r : []);
    } catch {
      setInstances([]);
    } finally {
      setInstancesBusy(false);
    }
  }

  const [iocResultsBusy, setIocResultsBusy] = useState(false);
  const [assetResultsBusy, setAssetResultsBusy] = useState(false);
  const [iocHistory, setIocHistory] = useState<Record<string, EnrichmentLite[]>>({});
  const [assetHistory, setAssetHistory] = useState<Record<string, EnrichmentLite[]>>({});
  const [actionRaw, setActionRaw] = useState<Record<string, boolean>>({});

  async function refreshIocHistory() {
    if (!ticketId) return;
    setIocResultsBusy(true);
    try {
      const r = await listConnectorResults({ case_id: ticketId, target_type: "ioc" as ConnectorTargetType });
      setIocHistory(buildHistoryIndex(r ?? []));
    } catch {
      setIocHistory({});
    } finally {
      setIocResultsBusy(false);
    }
  }

  async function refreshAssetHistory() {
    if (!ticketId) return;
    setAssetResultsBusy(true);
    try {
      const r = await listConnectorResults({ case_id: ticketId, target_type: "asset" as ConnectorTargetType });
      setAssetHistory(buildHistoryIndex(r ?? []));
    } catch {
      setAssetHistory({});
    } finally {
      setAssetResultsBusy(false);
    }
  }

  useEffect(() => {
    if (tab === "iocs" || tab === "assets") void loadConnectorInstances();
    if (tab === "iocs") void refreshIocHistory();
    if (tab === "assets") void refreshAssetHistory();
  }, [tab, ticketId]);

  const [selectMode, setSelectMode] = useState<null | "ioc" | "asset">(null);
  const [selectedIocKeys, setSelectedIocKeys] = useState<Record<string, boolean>>({});
  const [selectedAssetKeys, setSelectedAssetKeys] = useState<Record<string, boolean>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const lastRunModeRef = useRef<"ioc" | "asset" | null>(null);
  const prevDrawerOpenRef = useRef(false);

  useEffect(() => {
    if (tab === "iocs") setSelectedAssetKeys({});
    else if (tab === "assets") setSelectedIocKeys({});
  }, [tab]);

  useEffect(() => {
    const wasOpen = prevDrawerOpenRef.current;
    prevDrawerOpenRef.current = drawerOpen;
    if (wasOpen && !drawerOpen) {
      void (async () => {
        await refreshAll();
        if (lastRunModeRef.current === "ioc") await refreshIocHistory();
        else if (lastRunModeRef.current === "asset") await refreshAssetHistory();
        else {
          await refreshIocHistory();
          await refreshAssetHistory();
        }
      })();
    }
  }, [drawerOpen]);

  const activeSelectedKeys = useMemo(() => (selectMode === "asset" ? selectedAssetKeys : selectedIocKeys), [selectMode, selectedIocKeys, selectedAssetKeys]);
  const selectedTargets = useMemo(() => {
    const rows: any[] =
      selectMode === "ioc"
        ? ((event as any)?.iocs || [])
        : selectMode === "asset"
        ? ((event as any)?.assets || [])
        : [];

    const out: ConnectorTarget[] = [];

    for (const r of rows) {
      const rawK = String(r?.key ?? r?.field ?? "").trim();
      const v = String(r?.value ?? "").trim();
      if (!v) continue;

      const isIoc = selectMode === "ioc";
      const id = rowId(rawK, v);

      if (activeSelectedKeys[id]) {
        out.push({
          key: isIoc ? rawK || "ip" : rawK,
          value: v,
        });
      }
    }

    return out;
  }, [selectMode, activeSelectedKeys, event]);

  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [historyDrawerMode, setHistoryDrawerMode] = useState<"ioc" | "asset">("ioc");
  const [historyDrawerK, setHistoryDrawerK] = useState("");
  const [historyDrawerV, setHistoryDrawerV] = useState("");
  const historyBundle = useMemo(() => {
    const k = String(historyDrawerK ?? "").trim();
    const v = String(historyDrawerV ?? "").trim();

    if (!k && !v) {
      const allActions = Object.values(
        historyDrawerMode === "ioc" ? iocHistory : assetHistory
      )
        .flat()
        .sort((a, b) => {
          const da = Date.parse(String(a?.created_at ?? "")) || 0;
          const db = Date.parse(String(b?.created_at ?? "")) || 0;
          return db - da;
        });

      return {
        id: rowId(k, v),
        actions: allActions,
        latest: allActions[0] ?? null,
      };
    }

    if (!v) {
      return { id: rowId(k, v), actions: [] as EnrichmentLite[], latest: null as any };
    }

    if (historyDrawerMode === "ioc") {
      return getHistoryBundle(iocHistory, k, v, !k ? ["ip"] : []);
    }

    return getHistoryBundle(assetHistory, k, v, []);
  }, [historyDrawerMode, historyDrawerK, historyDrawerV, iocHistory, assetHistory]);
  function openHistoryDrawer(mode: "ioc" | "asset", k: string, v: string) {
    setHistoryDrawerMode(mode);
    setHistoryDrawerK(String(k ?? "").trim());
    setHistoryDrawerV(String(v ?? "").trim());
    setHistoryDrawerOpen(true);
  }

  if (error) return <div className="text-red-600">{error}</div>;
  if (!event) return <div>Loading •••</div>;

  const iocs: KVRow[] = ((event as any).iocs || []) as any;
  const assets: KVRow[] = ((event as any).assets || []) as any;

  return (
    <div className="space-y-6">
      <CaseHeader
        event={event}
        ticketId={ticketId}
        busy={busy}
        canUpdateCase={canUpdateCase}
        archiveBusy={archiveBusy}
        busyCaseId={busyCaseId}
        setBusyCaseId={setBusyCaseId}
        users={users}
        customers={customers}
        sevOptions={sevOptions}
        clsOptions={clsOptions}
        editableRef={editableRef}
        editTitle={editTitle}
        setEditTitle={setEditTitle}
        saveIfDirty={saveIfDirty}
        changeStatus={changeStatus}
        changeSeverity={changeSeverity}
        changeClassification={changeClassification}
        changeOutcome={changeOutcome}
        refreshAll={refreshAll}
        push={push}
        isArchived={isArchived}
        toggleArchive={toggleArchive}
        canDeleteCase={canDeleteCase}
        setConfirmDeleteCase={setConfirmDeleteCase}
        reportTemplates={reportTemplates}
        reportTplId={reportTplId}
        setReportTplId={setReportTplId}
        reportBusy={reportBusy}
        setReportBusy={setReportBusy}
      />

      <div className="flex gap-2 py-4">
        {[
          { k: "summary", label: "Summary" },
          { k: "exchanges", label: "Exchanges" },
          { k: "iocs", label: "IoCs" },
          { k: "assets", label: "Assets" },
          { k: "incident_timeline", label: "Incident Timeline" },
          { k: "activity", label: "Case activity" },
        ].map((t: any) => (
          <button
            key={t.k}
            type="button"
            className={`flex-1 border-none py-3 text-sm hover:bg-slate-800 hover:text-white font-semibold cursor-pointer transition-all duration-200 rounded-xl border-2 hover:-translate-y-1 active:scale-95 ${
              tab === t.k
                ? "bg-slate-800 text-white shadow-md hover:shadow-xl transform auto-scale-95"
                : "border-gray-100 bg-white shadow-md hover:shadow-xl hover:bg-slate-100 text-slate-500 hover:border-gray-300 hover:text-slate-700"
            }`}
            onClick={() => {
              setTab(t.k);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "summary" ? (
        <CaseSummaryTab
          busy={busy}
          editDescription={editDescription}
          description={event?.description ?? ""}
          canUpdateCase={canUpdateCase}
          setEditDescription={setEditDescription}
          saveIfDirty={saveIfDirty}
          onDescriptionFocusChange={(focused) => {
            descFocusedRef.current = focused;
          }}
          commentText={commentText}
          setCommentText={setCommentText}
          submitComment={submitComment}
          comments={comments}
          editingCommentId={editingCommentId}
          editingText={editingText}
          setEditingText={setEditingText}
          commentBusyId={commentBusyId}
          startEditComment={startEditComment}
          cancelEditComment={cancelEditComment}
          saveEditComment={saveEditComment}
          removeComment={removeComment}
          wbLoading={wbLoading}
          workbook={workbook}
          wbTemplates={wbTemplates}
          wbBusyApply={wbBusyApply}
          wbBusyItemId={wbBusyItemId}
          onApplyWorkbookTemplate={onApplyWorkbookTemplate}
          onToggleWorkbookItem={onToggleWorkbookItem}
          linkedAlerts={linkedAlerts as any}
          canUnmerge={canUnmerge}
          setConfirmUnmerge={setConfirmUnmerge}
          linkedTasks={linkedTasks}
          canViewTasks={canViewTasks}
          attachments={attachments}
          onUploadFile={onUploadFile}
          removeAttachment={removeAttachment}
        />
      ) : null}

      {tab === "exchanges" ? (
        <CaseExchangesTab
          busy={busy}
          exchangesBusy={exchangesBusy}
          canUpdateCase={canUpdateCase}
          setExchangesBusy={setExchangesBusy}
          exchanges={exchanges}
          refreshExchanges={refreshExchanges}
          openAddExchange={openAddExchange}
          selectedExchangeIds={selectedExchangeIds}
          setSelectedExchangeIds={setSelectedExchangeIds}
          toggleSelectExchange={toggleSelectExchange}
          openBulkReplyModal={openBulkReplyModal}
          bulkDeleteSelected={bulkDeleteSelected}
          openReplyModal={openReplyModal}
          openDetails={openDetails}
          exchangeView={exchangeView}
          setExchangeView={setExchangeView}
          exchangeViewDraft={exchangeViewDraft}
          setExchangeViewDraft={setExchangeViewDraft}
          autoFollowupEnabled={autoFollowupEnabled}
          setAutoFollowupEnabled={setAutoFollowupEnabled}
          autoFollowupDelayValue={autoFollowupDelayValue}
          setAutoFollowupDelayValue={setAutoFollowupDelayValue}
          autoFollowupDelayUnit={autoFollowupDelayUnit}
          setAutoFollowupDelayUnit={setAutoFollowupDelayUnit}
          autoFollowupQuickpartId={autoFollowupQuickpartId}
          setAutoFollowupQuickpartId={setAutoFollowupQuickpartId}
          autoFollowupOpen={autoFollowupOpen}
          setAutoFollowupOpen={setAutoFollowupOpen}
          saveAutoFollowupSettings={saveAutoFollowupSettings}
          autoFollowupAction={autoFollowupAction}
          setAutoFollowupAction={setAutoFollowupAction}
          onSendExchange={onSendExchange}
          followupSelectionOpen={followupSelectionOpen}
          setFollowupSelectionOpen={setFollowupSelectionOpen}
          followupSelectionAction={followupSelectionAction}
          setFollowupSelectionAction={setFollowupSelectionAction}
          configureSelectedFollowups={configureSelectedFollowups}
          disableSelectedFollowups={disableSelectedFollowups}
          replyModalOpen={replyModalOpen}
          closeReplyModal={closeReplyModal}
          replyTarget={replyTarget}
          exchangeDraft={exchangeDraft}
          setExchangeDraft={setExchangeDraft}
          saveReplyDraftToConversationOnly={saveReplyDraftToConversationOnly}
          exchangeCreateOpen={exchangeCreateOpen}
          setExchangeCreateOpen={setExchangeCreateOpen}
          sendBulkReplyIndividually={sendBulkReplyIndividually}
          replyTo={replyTo}
          quickparts={quickparts}
          quickpartsBusy={quickpartsBusy}
          selectedQuickpartId={selectedQuickpartId}
          applyQuickpartToBody={applyQuickpartToBody}
          onCreateExchange={onCreateExchange}
          bulkReplyOpen={bulkReplyOpen}
          setBulkReplyOpen={setBulkReplyOpen}
          bulkReplyTargets={bulkReplyTargets}
          bulkRecipients={bulkRecipients}
          bulkReplyDraft={bulkReplyDraft}
          setBulkReplyDraft={setBulkReplyDraft}
          saveBulkReplyConversationOnly={saveBulkReplyConversationOnly}
          push={push}
        />
      ) : null}

      {tab === "iocs" || tab === "assets" ? (
        <CaseIndicatorsTab
          tab={tab}
          ticketId={ticketId}
          canUpdateCase={canUpdateCase}
          event={event}
          iocs={iocs}
          assets={assets}
          busy={busy}
          push={push}
          refreshAll={refreshAll}
          refreshIocHistory={refreshIocHistory}
          refreshAssetHistory={refreshAssetHistory}
          iocResultsBusy={iocResultsBusy}
          assetResultsBusy={assetResultsBusy}
          iocHistory={iocHistory}
          assetHistory={assetHistory}
          selectedIocKeys={selectedIocKeys}
          setSelectedIocKeys={setSelectedIocKeys}
          selectedAssetKeys={selectedAssetKeys}
          setSelectedAssetKeys={setSelectedAssetKeys}
          selectMode={selectMode}
          setSelectMode={setSelectMode}
          lastRunModeRef={lastRunModeRef}
          setDrawerOpen={setDrawerOpen}
          instancesBusy={instancesBusy}
          openHistoryDrawer={openHistoryDrawer}
          actionRaw={actionRaw}
          setActionRaw={setActionRaw}
          setBusy={setBusy}
          setEvent={setEvent}
        />
      ) : null}

      {tab === "incident_timeline" ? <IncidentTimeline caseId={ticketId} disabled={busy} /> : null}
      {tab === "activity" ? <CaseActivityTab timeline={timeline as any} activityLimit={activityLimit} /> : null}

      <ConnectorRunnerDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} caseId={ticketId} targetType={selectMode === "asset" ? "asset" : "ioc"} targets={selectedTargets} instances={instances} />

      <ConfirmDialog
        open={!!confirm}
        title="Confirm"
        message={confirm?.kind === "comment" ? "Delete this comment ? This action cannot be undone." : "Delete this attachment ? This action cannot be undone."}
        confirmText="Delete"
        onCancel={() => {
          if (!busy) setConfirm(null);
        }}
        onConfirm={async () => {
          if (!confirm || busy) return;
          setBusy(true);
          const c = confirm;
          setConfirm(null);
          try {
            if (c.kind === "comment") {
              await deleteComment(c.id);
              push({ kind: "info", title: "Comment deleted" });
            } else {
              await deleteAttachment(c.id);
              push({ kind: "info", title: "Attachment deleted" });
            }
            await refreshAll();
          } catch (e: any) {
            push({ kind: "error", title: "Error", message: String(e?.response?.status ?? "network") });
          } finally {
            setBusy(false);
          }
        }}
      />

      {canUnmerge ? (
        <ConfirmDialog
          open={!!confirmUnmerge}
          title="Confirm"
          message={confirmUnmerge ? `Unmerge alert "${confirmUnmerge.title}" ? The alert status will be restored to its previous status.` : ""}
          confirmText="Unmerge"
          confirmTag="save"
          onCancel={() => {
            if (!busy) setConfirmUnmerge(null);
          }}
          onConfirm={async () => {
            if (!canUnmerge) return;
            if (!confirmUnmerge || busy) return;
            setBusy(true);
            const target = confirmUnmerge;
            setConfirmUnmerge(null);
            try {
              await unmergeAlert(target.id);
              push({ kind: "success", title: "Alert unmerged" });
              await refreshAll();
            } catch (e: any) {
              push({ kind: "error", title: "Error", message: String(e?.response?.status ?? "network") });
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}

      {canDeleteCase ? (
        <ConfirmDialog
          open={confirmDeleteCase}
          title="Confirm"
          message="Delete this case ?"
          confirmText="Delete"
          onCancel={() => {
            if (!busy) setConfirmDeleteCase(false);
          }}
          onConfirm={async () => {
            if (!canDeleteCase) return;
            if (!ticketId || busy) return;
            setBusy(true);
            try {
              await deleteCase(ticketId);
              push({ kind: "success", title: "Case deleted" });
              navigate("/cases");
            } catch (e: any) {
              push({ kind: "error", title: "Error", message: String(e?.response?.status ?? "network") });
            } finally {
              setBusy(false);
              setConfirmDeleteCase(false);
            }
          }}
        />
      ) : null}

      <CaseHistoryDrawer
        open={historyDrawerOpen}
        mode={historyDrawerMode}
        k={historyDrawerK}
        v={historyDrawerV}
        actions={historyBundle.actions}
        actionRaw={actionRaw}
        setActionRaw={setActionRaw}
        onClose={() => setHistoryDrawerOpen(false)}
      />
    </div>
  );
}
