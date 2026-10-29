import { useEffect, useMemo, useState } from "react";
import { createCaseExchange, sendCaseExchange, deleteCaseExchange, configureCaseExchangeFollowups, listAlertExchangeQuickparts, type CaseExchange } from "../../../api/exchanges";
import { listCaseExchangeQuickparts, type CaseExchangeQuickpart } from "../../../api/settingsCaseExchange";
import { joinCsv, normalizeSubjectForReply, parseCsv, uniqKeepOrder } from "./utils";

export function useExchanges({ ticketId, scope = "case", canUpdateCase, refreshExchanges, push }: {
  ticketId: string;
  scope?: "case" | "alert";
  canUpdateCase: boolean;
  refreshExchanges: () => Promise<void>;
  push: (message: any) => void;
}) {
  const createExchange = (id: string, payload: Partial<CaseExchange>) => createCaseExchange(id, payload, scope);
  const sendExchange = (id: string, payload: Partial<CaseExchange>) => sendCaseExchange(id, payload, scope);
  const configureFollowups = (id: string, payload: Parameters<typeof configureCaseExchangeFollowups>[1]) => configureCaseExchangeFollowups(id, payload, scope);
  const [autoFollowupAction, setAutoFollowupAction] = useState<"save" | "send">("save");
  const [autoFollowupEnabled, setAutoFollowupEnabled] = useState(false);
  const [autoFollowupDelayValue, setAutoFollowupDelayValue] = useState("24");
  const [autoFollowupDelayUnit, setAutoFollowupDelayUnit] = useState<
    "minute" | "hour" | "day" | "week" | "month"
  >("hour");
  const [autoFollowupQuickpartId, setAutoFollowupQuickpartId] = useState("");
  const [followupSelectionOpen, setFollowupSelectionOpen] = useState(false);
  const [followupSelectionAction, setFollowupSelectionAction] = useState<"save" | "send">("save");

  const [autoFollowupOpen, setAutoFollowupOpen] = useState(false);

  const [exchanges, setExchanges] = useState<CaseExchange[]>([]);
  const [exchangesBusy, setExchangesBusy] = useState(false);
  const [exchangeView, setExchangeView] = useState<CaseExchange | null>(null);
  const [exchangeViewDraft, setExchangeViewDraft] = useState({ channel: "", sender: "", to: "", cc: "", bcc: "", subject: "", body: "", message_id: "", references: "" });
  const [exchangeCreateOpen, setExchangeCreateOpen] = useState(false);
  const [exchangeDraft, setExchangeDraft] = useState({ direction: "inbound" as "inbound" | "outbound", channel: "email" as "email" | "other", sender: "", to: "", cc: "", bcc: "", subject: "", body: "", message_id: "", references: "" });
  const [replyTo, setReplyTo] = useState<CaseExchange | null>(null);

  function openAddExchange() {
    setReplyTo(null);
    setReplyTarget(null);
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
      await createExchange(ticketId, {
        reply_to: replyTarget?.id ?? null,
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
      for (const exId of ids) await deleteCaseExchange(exId, scope === "alert" ? ticketId : undefined);
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
        await createExchange(ticketId, {
          reply_to: x.id,
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
          reply_to: target.id,
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

        await sendExchange(ticketId, payload);
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
      const r = scope === "alert" ? await listAlertExchangeQuickparts() : await listCaseExchangeQuickparts({ q: "" });
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

  async function onCreateExchange() {
    if (!canUpdateCase) return;
    if (!ticketId) return;
    setExchangesBusy(true);
    try {
      await createExchange(ticketId, {
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
      await sendExchange(ticketId, {
        reply_to: replyTarget?.id ?? null,
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
      if (replyModalOpen) closeReplyModal();
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
      await configureFollowups(ticketId, {
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
      await configureFollowups(ticketId, {
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



  return { exchangesBusy, setExchangesBusy, exchanges, openAddExchange, selectedExchangeIds, setSelectedExchangeIds, toggleSelectExchange, openBulkReplyModal, bulkDeleteSelected, openReplyModal, openDetails, exchangeView, setExchangeView, exchangeViewDraft, setExchangeViewDraft, autoFollowupEnabled, setAutoFollowupEnabled, autoFollowupDelayValue, setAutoFollowupDelayValue, autoFollowupDelayUnit, setAutoFollowupDelayUnit, autoFollowupQuickpartId, setAutoFollowupQuickpartId, autoFollowupOpen, setAutoFollowupOpen, autoFollowupAction, setAutoFollowupAction, onSendExchange, followupSelectionOpen, setFollowupSelectionOpen, followupSelectionAction, setFollowupSelectionAction, configureSelectedFollowups, disableSelectedFollowups, replyModalOpen, closeReplyModal, replyTarget, exchangeDraft, setExchangeDraft, saveReplyDraftToConversationOnly, exchangeCreateOpen, setExchangeCreateOpen, sendBulkReplyIndividually, replyTo, quickparts, quickpartsBusy, selectedQuickpartId, applyQuickpartToBody, onCreateExchange, bulkReplyOpen, setBulkReplyOpen, bulkReplyTargets, bulkRecipients, bulkReplyDraft, setBulkReplyDraft, saveBulkReplyConversationOnly, setExchanges };
}
