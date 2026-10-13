import { useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "../contexts/MeContext";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { useToast } from "../components/ui/toast";
import {
  deleteChatSession,
  renameChatSession,
  ChatMessage,
  ChatRun,
  ChatSession,
  createChatRun,
  createChatSession,
  fetchChatRun,
  listDedicatedChatSessions,
  fetchChatSession,
  cancelChatRun,
  orderChatMessages,
} from "../api/chat";
import { getClientTabId, makeRequestId } from "../auth/clientTab";
import {
  SendButton,
  CopyButton,
  ClearButton,
  NewGenButton,
} from "../components/ui/IconButton";
import ChatMessageContent from "../components/chat/ChatMessageContent";

function PollingStatus({ run }: { run: ChatRun | null }) {
  if (!run) return null;

  const label =
    run.status === "running" || run.status === "queued"
      ? "Generating..."
      : run.status === "failed"
      ? "Failed"
      : run.status === "cancelled"
      ? "Cancelled"
      : "Completed";

  const tone =
    run.status === "running" || run.status === "queued"
      ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : run.status === "failed" || run.status === "cancelled"
      ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400"
      : "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";

  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        tone,
      ].join(" ")}
    >
      {label}
    </span>
  );
}


function RunThinkingBlock({ run }: { run: ChatRun | null }) {
  if (!run || !["queued", "running"].includes(run.status)) return null;

  const progress = (run.provider_execution as any)?.ui_progress || {};
  const label = run.cancel_requested
    ? "Cancel in progress…"
    : progress.label || "Thinking…";
  const preview = String(progress.preview || "").trim();

  return (
    <div className="flex justify-start">
      <div className="max-w-[82%] min-w-0">
        <details className="rounded-[24px] border border-border bg-card px-4 py-3 text-sm shadow-sm">
          <summary className="cursor-pointer list-none">
            <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              {label}
            </span>
          </summary>
          <div className="mt-3 whitespace-pre-wrap break-words border-t border-border pt-3 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
            {preview || "No preview available. This is not streaming."}
          </div>
        </details>
      </div>
    </div>
  );
}


function MessageBubble({
  message,
}: {
  message: ChatMessage;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[82%] min-w-0">
        <div
          className={[
            "min-w-0 overflow-hidden rounded-[24px] px-4 py-3 shadow-sm",
            isUser
              ? "bg-foreground text-background"
              : "border border-border bg-card text-foreground",
          ].join(" ")}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
              {message.content}
            </div>
          ) : (
            <ChatMessageContent html={message.content} />
          )}

          <div
            className={[
              "mt-3 flex items-center justify-between gap-3 text-[11px]",
              isUser ? "text-background/70" : "text-muted-foreground",
            ].join(" ")}
          >
            <span>
              {new Date(message.created_at).toLocaleString()}
            </span>

            {!isUser ? (
              <CopyButton
                type="button"
                onClick={() => void navigator.clipboard.writeText(message.content)}
                title="Copy response"
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChatbotPage() {
  const toast = useToast();
  const me = useMe();
  const can = (p: string) => !!me?.is_admin || !!me?.permissions?.includes(p);
  const canUseChat = can("chat.use");
  const canUseChatLlm = can("chat.llm.use");

  const clientTabId = useMemo(() => getClientTabId(), []);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [prompt, setPrompt] = useState("");
  const [run, setRun] = useState<ChatRun | null>(null);
  const [busy, setBusy] = useState(false);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const messagesContentRef = useRef<HTMLDivElement | null>(null);
  const followOutput = useRef(true);
  const lastScrollTop = useRef(0);
  const [clearing, setClearing] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingTitle, setEditingTitle] = useState<{ id: string; title: string } | null>(null);
  const editingTitleId = useRef<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const selectionVersion = useRef(0);
  const drafts = useRef<Record<string, string>>({});
  const preserveScroll = useRef(false);

  function startRenaming(item: ChatSession) {
    editingTitleId.current = item.id;
    setEditingTitle({ id: item.id, title: item.title || "" });
  }

  async function saveTitle() {
    if (!editingTitle || editingTitleId.current !== editingTitle.id) return;
    const { id, title } = editingTitle;
    editingTitleId.current = null;
    setEditingTitle(null);
    const trimmed = title.trim();
    if (!trimmed || sessions.find(item => item.id === id)?.title === trimmed) return;
    try {
      const renamed = await renameChatSession(id, trimmed);
      setSessions(prev => prev.map(item => item.id === id ? { ...item, title: renamed.title } : item));
      setActiveSession(prev => prev?.id === id ? { ...prev, title: renamed.title } : prev);
    } catch (e: any) {
      toast.push({ kind: "error", title: "Catbot", message: e?.response?.data?.detail || "Unable to rename conversation" });
    }
  }

  async function selectConversation(id: string) {
    if (busy || clearing || loading) return;
    if (id === activeSession?.id) return;
    followOutput.current = true;
    lastScrollTop.current = 0;
    if (activeSession) drafts.current[activeSession.id] = prompt;
    const version = ++selectionVersion.current;
    setLoading(true);
    setActiveSession(null);
    setRun(null);
    setPrompt(drafts.current[id] || "");
    try {
      const item = await fetchChatSession(id);
      if (version !== selectionVersion.current) return;
      setActiveSession(item);
      setRun(item.active_run || null);
    } catch (e: any) {
      if (version === selectionVersion.current) toast.push({ kind: "error", title: "Catbot", message: e?.response?.data?.detail || "Unable to load conversation" });
    } finally {
      if (version === selectionVersion.current) setLoading(false);
    }
  }

  async function newConversation() {
    if (busy || clearing || loading) return;
    followOutput.current = true;
    lastScrollTop.current = 0;
    if (activeSession) drafts.current[activeSession.id] = prompt;
    const version = ++selectionVersion.current;
    const previousRun = run;
    setRun(null);
    setLoading(true);
    setCreating(true);
    try {
      const item = await createChatSession({ title: "New chat", surface: "dedicated", client_tab_id: clientTabId });
      if (version !== selectionVersion.current) return;
      setSessions(prev => [item, ...prev]);
      setNextOffset(prev => prev === null ? null : prev + 1);
      setActiveSession(item);
      setRun(null);
      setPrompt("");
    } catch (e: any) {
      if (version === selectionVersion.current) {
        setRun(previousRun);
        toast.push({ kind: "error", title: "Catbot", message: e?.response?.data?.detail || "Unable to create conversation" });
      }
    } finally {
      setCreating(false);
      if (version === selectionVersion.current) setLoading(false);
    }
  }

  async function loadMoreConversations() {
    if (nextOffset === null || loadingList) return;
    setLoadingList(true);
    const version = selectionVersion.current;
    try {
      const page = await listDedicatedChatSessions(nextOffset);
      if (version !== selectionVersion.current) return;
      setSessions(prev => [...prev, ...page.results.filter(item => !prev.some(existing => existing.id === item.id))]);
      setNextOffset(page.next_offset);
    } catch {
      if (version === selectionVersion.current) toast.push({ kind: "error", title: "Catbot", message: "Unable to load more conversations" });
    } finally {
      setLoadingList(false);
    }
  }

  async function loadOlderMessages() {
    if (!activeSession?.older_cursor || loadingOlder) return;
    followOutput.current = false;
    const version = selectionVersion.current;
    setLoadingOlder(true);
    try {
      const page = await fetchChatSession(activeSession.id, activeSession.older_cursor);
      if (version !== selectionVersion.current) return;
      const element = messagesScrollRef.current;
      const oldHeight = element?.scrollHeight || 0;
      const oldTop = element?.scrollTop || 0;
      preserveScroll.current = true;
      setActiveSession(prev => prev && prev.id === page.id ? { ...prev, older_cursor: page.older_cursor, messages: [...(page.messages || []).filter(item => !prev.messages?.some(existing => existing.id === item.id)), ...(prev.messages || [])] } : prev);
      requestAnimationFrame(() => {
        if (element && version === selectionVersion.current) element.scrollTop = oldTop + element.scrollHeight - oldHeight;
      });
    } catch {
      if (version === selectionVersion.current) toast.push({ kind: "error", title: "Catbot", message: "Unable to load older messages" });
    } finally {
      setLoadingOlder(false);
    }
  }

  const displayMessages = useMemo(() => {
    const baseMessages = [...(activeSession?.messages || [])];

    if (
      run?.status === "completed" &&
      run.response_text &&
      !baseMessages.some(
        (message) =>
          message.role === "assistant" &&
          message.metadata?.run_id === run.id
      )
    ) {
      baseMessages.push({
        id: `run-${run.id}`,
        role: "assistant",
        content: run.response_text,
        created_at:
          run.completed_at || run.created_at || new Date().toISOString(),
        metadata: { run_id: run.id, request_id: run.request_id },
      });
    }

    return orderChatMessages(baseMessages);
  }, [activeSession?.messages, run]);


  const isGenerating =
    busy ||
    run?.status === "queued" ||
    run?.status === "running";


  useEffect(() => {
    const version = ++selectionVersion.current;
    setActiveSession(null);
    setSessions([]);
    setRun(null);
    setPrompt("");
    drafts.current = {};
    editingTitleId.current = null;
    setEditingTitle(null);
    followOutput.current = true;
    setLoading(true);
    void (async () => {
      if (!canUseChat) { setLoading(false); return; }
      try {
        const page = await listDedicatedChatSessions();
        if (version !== selectionVersion.current) return;
        setSessions(page.results);
        setNextOffset(page.next_offset);
        if (page.results[0]) {
          const item = await fetchChatSession(page.results[0].id);
          if (version !== selectionVersion.current) return;
          setActiveSession(item);
          setRun(item.active_run || null);
        }
      } catch (e: any) {
        if (version !== selectionVersion.current) return;
        toast.push({
          kind: "error",
          title: "Chat",
          message: e?.message || "Unable to load chat session",
        });
      } finally {
        if (version === selectionVersion.current) setLoading(false);
      }
    })();
    return () => { selectionVersion.current++; };
  }, [clientTabId, toast, me?.id, canUseChat]);

  useEffect(() => {
    if (!run || (run.status !== "queued" && run.status !== "running")) return;

    let stopped = false;
    const version = selectionVersion.current;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const refreshed = await fetchChatRun(run.id);
        if (stopped || version !== selectionVersion.current) return;
        setRun(refreshed);

        if (
          refreshed.status === "completed" &&
          refreshed.response_text
        ) {
          setActiveSession((prev) => {
            if (!prev) return prev;

            const alreadyExists = (prev.messages || []).some(
              (m) => m.role === "assistant" && m.metadata?.run_id === refreshed.id
            );
            if (alreadyExists) return prev;

            const assistantMessage: ChatMessage = {
              id: `run-${refreshed.id}`,
              role: "assistant",
              content: refreshed.response_text,
              created_at: refreshed.completed_at || new Date().toISOString(),
              metadata: {
                run_id: refreshed.id,
                request_id: refreshed.request_id,
              },
            };

            return {
              ...prev,
              messages: [...(prev.messages || []), assistantMessage],
            };
          });
        }

        if (["completed", "failed", "cancelled"].includes(refreshed.status)) {
          return;
        }
      } catch {
        return;
      }

      if (!stopped) {
        timer = window.setTimeout(poll, 1500);
      }
    };

    timer = window.setTimeout(poll, 1500);

    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [run?.id, run?.status]);

  async function handleClearConversation() {
    if (!activeSession || clearing || isGenerating) return;

    setClearing(true);
    const version = ++selectionVersion.current;

    try {
      const previousSessionId = activeSession.id;
      await deleteChatSession(previousSessionId);
      if (version !== selectionVersion.current) return;
      const remaining = sessions.filter(item => item.id !== previousSessionId);
      setSessions(remaining);
      setNextOffset(prev => prev === null ? null : Math.max(0, prev - 1));
      delete drafts.current[previousSessionId];
      setActiveSession(null);
      setRun(null);
      setPrompt("");
      setDeleteOpen(false);

      toast.push({
        kind: "success",
        title: "Assistant",
        message: "Conversation deleted",
      });
    } catch (e: any) {
      if (version === selectionVersion.current) toast.push({
        kind: "error",
        title: "Assistant",
        message:
          e?.response?.data?.detail || e?.message ||
          "Unable to clear conversation",
      });
    } finally {
      setClearing(false);
    }
  }

  useEffect(() => {
    if (preserveScroll.current) { preserveScroll.current = false; return; }
    const element = messagesScrollRef.current;
    if (element && followOutput.current) {
      element.scrollTop = element.scrollHeight;
      lastScrollTop.current = element.scrollTop;
    }
  }, [activeSession?.id, displayMessages.length, run?.error_message, run?.status]);

  useEffect(() => {
    const element = messagesScrollRef.current;
    const content = messagesContentRef.current;
    if (!element || !content) return;
    const observer = new ResizeObserver(() => {
      if (followOutput.current) {
        element.scrollTop = element.scrollHeight;
        lastScrollTop.current = element.scrollTop;
      }
    });
    observer.observe(content);
    observer.observe(element);
    return () => observer.disconnect();
  }, [canUseChat]);

  function handlePromptKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isGenerating && canUseChatLlm && prompt.trim()) {
        void handleSend();
      }
    }
  }

  async function handleSend() {
    if (!activeSession || !prompt.trim() || !canUseChatLlm || isGenerating || loading || clearing) return;
    followOutput.current = true;
    const version = selectionVersion.current;

    const message = prompt.trim();
    const requestId = makeRequestId();
    const optimisticMessage: ChatMessage = {
      id: `tmp-${requestId}`,
      role: "user",
      content: message,
      created_at: new Date().toISOString(),
      metadata: { request_id: requestId },
    };

    setPrompt("");
    setBusy(true);
    setActiveSession((prev) =>
      prev
        ? {
            ...prev,
            messages: [...(prev.messages || []), optimisticMessage],
          }
        : prev
    );

    try {
      const createdRun = await createChatRun(activeSession.id, {
        client_tab_id: clientTabId,
        request_id: requestId,
        message,
        page_type: "global",
        inclusions: [],
      });

      if (version !== selectionVersion.current) return;
      setRun(createdRun);
      delete drafts.current[activeSession.id];
      setSessions(prev => prev.map(item => item.id === activeSession.id && !activeSession.messages?.length && (!item.title || item.title === "New chat") ? { ...item, title: message.replace(/\s+/g, " ").slice(0, 80) } : item));
    } catch (e: any) {
      if (version !== selectionVersion.current) return;
      setActiveSession((prev) =>
        prev
          ? {
              ...prev,
              messages: (prev.messages || []).filter(
                (item) => item.id !== optimisticMessage.id
              ),
            }
          : prev
      );
      setPrompt(message);

      toast.push({
        kind: "error",
        title: "Chat",
        message: e?.message || "Unable to send message",
      });
    } finally {
      setBusy(false);
    }
  }


  async function handleCancelRun() {
    if (!run || !["queued", "running"].includes(run.status)) return;
    const version = selectionVersion.current;

    setRun((prev) =>
      prev
        ? {
            ...prev,
            cancel_requested: true,
            provider_execution: {
              ...(prev.provider_execution || {}),
              ui_progress: {
                label: "Cancel in progress…",
                preview: "",
                updated_at: new Date().toISOString(),
              },
            },
          }
        : prev
    );

    const cancelMessage: ChatMessage = {
      id: `cancel-${run.id}-${Date.now()}`,
      role: "assistant",
      content: "Cancel in progress…",
      created_at: new Date().toISOString(),
      metadata: {
        run_id: run.id,
        message_kind: "cancel_progress",
      },
    };

    setActiveSession((prev) =>
      prev
        ? {
            ...prev,
            messages: [...(prev.messages || []), cancelMessage],
          }
        : prev
    );

    try {
      const cancelled = await cancelChatRun(run.id);
      if (version === selectionVersion.current) setRun(cancelled);
    } catch (e: any) {
      if (version !== selectionVersion.current) return;
      toast.push({
        kind: "error",
        title: "Chat",
        message: e?.message || "Unable to cancel the run",
      });
    }
  }


  if (!canUseChat) {
    return (
      <div className="space-y-3">
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          Catbot
        </div>
        <div className="text-sm text-muted-foreground">Access denied.</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Catbot
          </h1>
        <div className="flex flex-wrap items-center gap-2">
          <PollingStatus run={run} />
          <ClearButton
            type="button"
            onClick={() => setDeleteOpen(true)}
            disabled={clearing || isGenerating || loading || !activeSession}
            title={isGenerating ? "Wait for the response or cancel it before deleting" : "Delete conversation"}
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row">
        <aside aria-label="Conversations" className="flex shrink-0 flex-col gap-2 sm:w-40 sm:min-h-0 lg:w-44">
          <NewGenButton title="New conversation" label="New conversation" iconOnly={false} onClick={() => void newConversation()} disabled={loading || busy || clearing} />
          <select aria-label="Select conversation" className="rounded-xl border border-border bg-card p-2 text-sm text-foreground sm:hidden" value={activeSession?.id || ""} disabled={busy || clearing || loading} onChange={event => void selectConversation(event.target.value)}>
            <option value="" disabled>Select a conversation</option>
            {sessions.map(item => <option key={item.id} value={item.id}>{item.title || "New chat"}</option>)}
          </select>
          <div className="hidden min-h-0 flex-1 space-y-1 overflow-y-auto sm:block">
            {sessions.map(item => (
              editingTitle?.id === item.id ? <input key={item.id} autoFocus aria-label="Conversation title" maxLength={255} value={editingTitle.title} onFocus={event => event.currentTarget.select()} onChange={event => setEditingTitle({ id: item.id, title: event.target.value })} onBlur={() => void saveTitle()} onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter") { event.preventDefault(); void saveTitle(); }
                if (event.key === "Escape") { event.preventDefault(); editingTitleId.current = null; setEditingTitle(null); }
              }} className="block w-full min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none" /> :
              <button key={item.id} type="button" title={item.title || "New chat"} aria-current={activeSession?.id === item.id ? "true" : undefined} disabled={busy || clearing || creating} onClick={() => void selectConversation(item.id)} onDoubleClick={() => startRenaming(item)} className={`block w-full truncate rounded-xl border px-3 py-2 text-left text-sm transition disabled:opacity-50 ${activeSession?.id === item.id ? "border-border bg-muted text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                {item.title || "New chat"}
              </button>
            ))}
          </div>
          {nextOffset !== null ? <button type="button" className="shrink-0 text-xs text-muted-foreground hover:text-foreground" disabled={loadingList} onClick={() => void loadMoreConversations()}>{loadingList ? "Loading…" : "More conversations"}</button> : null}
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div ref={messagesScrollRef} onScroll={event => {
            const element = event.currentTarget;
            if (element.scrollHeight - element.clientHeight - element.scrollTop <= 32) followOutput.current = true;
            else if (element.scrollTop < lastScrollTop.current) followOutput.current = false;
            lastScrollTop.current = element.scrollTop;
          }} aria-label="Conversation messages" className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-background p-3 sm:p-4">
              <div ref={messagesContentRef} className="space-y-4">
                {activeSession?.older_cursor ? <button type="button" className="text-xs text-muted-foreground hover:text-foreground" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>{loadingOlder ? "Loading…" : "Older messages"}</button> : null}
                {displayMessages.length === 0 ? (
                  <div className="flex items-center justify-center px-4 py-8 text-center">
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        {loading ? "Loading…" : activeSession ? "No messages yet" : "Start a new conversation or select one"}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Ask about recent cases, IoCs, hunts, dashboards, or audit activity.
                      </div>
                    </div>
                  </div>
                ) : (
                  displayMessages.map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))
                )}

                {isGenerating ? <RunThinkingBlock run={run} /> : null}

                {run?.error_message ? (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                    {run.error_message}
                  </div>
                ) : null}

              </div>
          </div>

          <div className="shrink-0 p-1">
            <div className="mx-auto flex w-full flex-col gap-2">
              
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-2">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={handlePromptKeyDown}
                    rows={2}
                    aria-label="Message"
                    disabled={!activeSession || loading || clearing || !canUseChatLlm || isGenerating}
                    placeholder="Ask about recent cases, search for an IOC, request a summary, or build a cross-object view."
                    className="w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                  />
                  <div className="text-[11px] italic text-muted-foreground px-1">
                    Enter to send · Shift+Enter for a new line
                  </div>
                </div>

                <div className="pt-1">
                  <div className="flex flex-col gap-2 pt-1">
                    <SendButton
                      type="button"
                      onClick={() => void handleSend()}
                      disabled={!activeSession || loading || clearing || isGenerating || !canUseChatLlm || !prompt.trim()}
                      title="Send"
                      iconOnly={false}
                      label={isGenerating ? "Sending..." : "Send"}
                    />

                    {isGenerating ? (
                      <button
                        type="button"
                        onClick={() => void handleCancelRun()}
                        disabled={!!run?.cancel_requested}
                        className="rounded-xl border border-border px-3 py-2 text-sm text-foreground disabled:opacity-50"
                      >
                        {run?.cancel_requested ? "Cancelling..." : "Cancel"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ConfirmDialog open={deleteOpen} title="Delete conversation?" message="This conversation and its messages will be permanently deleted." onConfirm={() => void handleClearConversation()} onCancel={() => { if (!clearing) setDeleteOpen(false); }} />
    </div>
  );
}
