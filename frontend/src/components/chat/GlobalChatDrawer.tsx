import { useEffect, useMemo, useState, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useToast } from "../ui/toast";
import {
  ChatRun,
  ChatSession,
  ChatMessage,
  ChatAction,
  createChatRun,
  createChatSession,
  fetchChatRun,
  cancelChatRun,
  listChatSessions,
  listChatActions,
  generateDraft,
  postDraft,
  archiveChatSession,
} from "../../api/chat";
import { getClientTabId, makeRequestId } from "../../auth/clientTab";
import {
  SendButton,
  CopyButton,
  Cat,
  ClearButton,
  CancelButton,
  ExternalLink,
  X,
} from "../../components/ui/IconButton";
import ChatMessageContent from "./ChatMessageContent";
import ChatCommandMenu from "./ChatCommandMenu";



type GlobalChatDrawerProps = {
  open: boolean;
  onClose: () => void;
};

function routeToPageType(pathname: string): string {
  if (pathname.startsWith("/cases/")) return "case";
  if (pathname.startsWith("/alerts/")) return "alert";
  if (pathname.startsWith("/hunts/")) return "hunt";
  if (pathname.startsWith("/tasks/")) return "task";
  if (pathname.startsWith("/audit")) return "audit";
  if (pathname.startsWith("/dashboard")) return "dashboard";
  return "global";
}

function extractObjectId(pathname: string): string | undefined {
  const parts = pathname.split("/").filter(Boolean);

  if (
    parts.length >= 2 &&
    ["cases", "alerts", "hunts", "tasks"].includes(parts[0])
  ) {
    return parts[1] || undefined;
  }

  return undefined;
}

function getCurrentContextTab(pathname: string): string | undefined {
  const value = sessionStorage.getItem(`doko:chat:tab:${pathname}`);
  return value || undefined;
}

function getContextLabel(pathname: string): string {
  if (pathname.startsWith("/cases/")) return "Current case context";
  if (pathname.startsWith("/alerts/")) return "Current alert context";
  if (pathname.startsWith("/hunts/")) return "Current hunt context";
  if (pathname.startsWith("/tasks/")) return "Current task context";
  if (pathname.startsWith("/audit")) return "Current audit context";
  if (pathname.startsWith("/dashboard")) return "Current dashboard context";
  return "Global workspace";
}

function PollingStatus({ run }: { run: ChatRun | null }) {
  if (!run) return null;

  const label = run.cancel_requested
    ? "Cancelling…"
    : run.status === "running" || run.status === "queued"
    ? "Generating…"
    : run.status === "failed"
    ? "Failed"
    : run.status === "cancelled"
    ? "Cancelled"
    : "Completed";

  const tone =
    run.status === "failed"
      ? "text-destructive"
      : run.status === "completed"
      ? "text-emerald-600 dark:text-emerald-400"
      : run.status === "cancelled"
      ? "text-amber-600 dark:text-amber-400"
      : "text-muted-foreground";

  return <div className={`text-xs ${tone}`}>{label}</div>;
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

export default function GlobalChatDrawer(props: GlobalChatDrawerProps) {
  const toast = useToast();
  const location = useLocation();
  const clientTabId = useMemo(() => getClientTabId(), []);
  const pageType = useMemo(
    () => routeToPageType(location.pathname),
    [location.pathname]
  );
  const objectId = useMemo(
    () => extractObjectId(location.pathname),
    [location.pathname]
  );

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [prompt, setPrompt] = useState("");
  const [run, setRun] = useState<ChatRun | null>(null);
  const [busy, setBusy] = useState(false);
  const currentTab = useMemo(
    () => getCurrentContextTab(location.pathname),
    [location.pathname, props.open]
  );
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const [postingRunId, setPostingRunId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [chatActions, setChatActions] = useState<ChatAction[]>([]);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [commandActiveIndex, setCommandActiveIndex] = useState(0);

  const displayMessages = useMemo(() => {
    const baseMessages = [...(activeSession?.messages || [])];

    if (
      run?.status === "completed" &&
      run.response_text &&
      !baseMessages.some(
        (message) =>
          message.role === "assistant" && message.metadata?.run_id === run.id
      )
    ) {
      baseMessages.push({
        id: `run-${run.id}`,
        role: "assistant",
        content: run.response_text,
        created_at:
          run.completed_at || run.created_at || new Date().toISOString(),
        metadata: { run_id: run.id },
      });
    }

    return baseMessages;
  }, [activeSession?.messages, run]);

  const isGenerating =
    busy ||
    run?.status === "queued" ||
    run?.status === "running" ||
    !!run?.cancel_requested;

  useEffect(() => {
    setActiveSession(null);
    setRun(null);
    setPrompt("");
    setSessions([]);
  }, [location.pathname, clientTabId]);

  useEffect(() => {
    if (!props.open) return;

    void (async () => {
      try {
        const items = await listChatSessions();
        setSessions(items);

        const matching = items.find(
          (item) =>
            item.surface === "contextual" &&
            item.client_tab_id === clientTabId &&
            (item.page_type || "") === pageType &&
            (item.object_id || "") === (objectId || "")
        );

        if (matching) {
          setActiveSession(matching);
        } else {
          const created = await createChatSession({
            title: "Assistant",
            surface: "contextual",
            page_type:
              pageType === "global"
                ? undefined
                : (pageType as "dashboard" | "alert" | "case" | "hunt" | "task" | "audit"),
            object_id: objectId,
            client_tab_id: clientTabId,
          });

          setSessions((prev) => [created, ...prev]);
          setActiveSession(created);
        }
      } catch (e: any) {
        toast.push({
          kind: "error",
          title: "Assistant",
          message: e?.message || "Unable to load assistant",
        });
      }
    })();
  }, [props.open, clientTabId, pageType, objectId, toast]);


  useEffect(() => {
    if (!props.open) return;

    let cancelled = false;

    void (async () => {
      try {
        const items = await listChatActions();
        if (!cancelled) {
          setChatActions(items);
        }
      } catch {
        if (!cancelled) {
          setChatActions([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props.open]);


  useEffect(() => {
    if (!run || (run.status !== "queued" && run.status !== "running")) return;

    const timer = window.setInterval(async () => {
      try {
        const refreshed = await fetchChatRun(run.id);
        setRun(refreshed);

        if (
          refreshed.status === "completed" &&
          refreshed.response_text &&
          activeSession
        ) {
          setActiveSession((prev) => {
            if (!prev) return prev;

            const alreadyExists = (prev.messages || []).some(
              (m) =>
                m.role === "assistant" && m.metadata?.run_id === refreshed.id
            );
            if (alreadyExists) return prev;

            const assistantMessage: ChatMessage = {
              id: `run-${refreshed.id}`,
              role: "assistant",
              content: refreshed.response_text,
              created_at: refreshed.completed_at || new Date().toISOString(),
              metadata: { run_id: refreshed.id },
            };

            return {
              ...prev,
              messages: [...(prev.messages || []), assistantMessage],
            };
          });
        }

        if (["completed", "failed", "cancelled"].includes(refreshed.status)) {
          window.clearInterval(timer);
        }
      } catch {
        window.clearInterval(timer);
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [run?.id, run?.status, activeSession]);

  useEffect(() => {
    if (!props.open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        props.onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onClose]);

  useEffect(() => {
    if (!props.open) return;
    scrollToBottom();
  }, [props.open, activeSession?.messages?.length, run?.status]);

  function scrollToBottom() {
    window.setTimeout(() => {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 0);
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.push({
        kind: "success",
        title: "Assistant",
        message: "Copied to clipboard",
      });
    } catch {
      toast.push({
        kind: "error",
        title: "Assistant",
        message: "Unable to copy text",
      });
    }
  }

  async function handleCancelRun() {
    if (!run || !["queued", "running"].includes(run.status)) return;

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
      setRun(cancelled);
    } catch (e: any) {
      toast.push({
        kind: "error",
        title: "Assistant",
        message: e?.message || "Unable to cancel the run",
      });
    }
  }

  async function handlePostAssistantMessage(runId: string) {
    if (!objectId) return;

    let targetType: "case_comment" | "alert_comment" | "hunt_note" | null = null;

    if (pageType === "case") targetType = "case_comment";
    if (pageType === "alert") targetType = "alert_comment";
    if (pageType === "hunt") targetType = "hunt_note";

    if (!targetType) return;

    setPostingRunId(runId);
    try {
      const draft = await generateDraft(runId, {
        target_type: targetType,
        target_id: objectId,
      });
      await postDraft(draft.id);

      window.dispatchEvent(
        new CustomEvent("doko:chat-posted", {
          detail: {
            pageType,
            objectId,
            targetType,
            postedAt: Date.now(),
          },
        })
      );

      toast.push({
        kind: "success",
        title: "Assistant",
        message:
          pageType === "hunt"
            ? "Response added to hunt journal"
            : "Response posted as comment",
      });
    } catch (e: any) {
      toast.push({
        kind: "error",
        title: "Assistant",
        message: e?.message || "Unable to post response",
      });
    } finally {
      setPostingRunId(null);
    }
  }

  async function handleClearConversation() {
    if (!activeSession) return;

    setClearing(true);
    try {
      await archiveChatSession(activeSession.id);

      const created = await createChatSession({
        title: "Assistant",
        surface: "contextual",
        page_type: pageType === "global" ? undefined : pageType,
        object_id: objectId,
        client_tab_id: clientTabId,
      });

      setSessions((prev) => [
        created,
        ...prev.filter((x) => x.id !== activeSession.id),
      ]);
      setActiveSession(created);
      setRun(null);
      setPrompt("");

      toast.push({
        kind: "success",
        title: "Assistant",
        message: "Conversation cleared",
      });
    } catch (e: any) {
      toast.push({
        kind: "error",
        title: "Assistant",
        message: e?.message || "Unable to clear conversation",
      });
    } finally {
      setClearing(false);
    }
  }


  const matchingActions = prompt.trimStart().startsWith("/")
    ? chatActions.filter((item) => {
        const haystack = [
          item.chat_command,
          item.name,
          item.description,
          item.command_help,
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(prompt.trimStart().toLowerCase());
      })
    : [];
  
  
  function handlePromptKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (commandMenuOpen && matchingActions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCommandActiveIndex((prev) =>
          Math.min(prev + 1, matchingActions.length - 1)
        );
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCommandActiveIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setCommandMenuOpen(false);
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        const current = matchingActions[commandActiveIndex];
        if (current) {
          e.preventDefault();
          setPrompt(`${current.chat_command} `);
          setCommandMenuOpen(false);
          setCommandActiveIndex(0);
          return;
        }
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!busy && prompt.trim()) {
        void handleSend();
      }
    }
  }

  async function handleSend() {
    if (!activeSession || !prompt.trim()) return;

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
    setCommandMenuOpen(false);
    setCommandActiveIndex(0);
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
        current_tab: currentTab,
        request_id: requestId,
        message,
        page_type: pageType,
        object_id: objectId,
        inclusions: [],
      });

      setRun(createdRun);
    } catch (e: any) {
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
        title: "Assistant",
        message: e?.message || "Unable to send message",
      });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!props.open) return;

    const timer = window.setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }, 30);

    return () => window.clearTimeout(timer);
  }, [props.open, displayMessages.length, run?.error_message, run?.status]);

  if (!props.open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-background/50 backdrop-blur-[2px]"
        onClick={props.onClose}
      />

      <aside className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-[800px] flex-col border-l border-border bg-card/95 shadow-panel backdrop-blur-2xl">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-background text-foreground shadow-sm">
                  <Cat className="h-5 w-5" />
                </div>

                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Catbot
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {getContextLabel(location.pathname)}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                to="/chatbot"
                onClick={props.onClose}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                title="Open dedicated page"
                aria-label="Open dedicated page"
              >
                <ExternalLink className="h-4 w-4" />
              </Link>

              <ClearButton
                iconOnly={false}
                title="Clear conversation"
                onClick={() => void handleClearConversation()}
                disabled={clearing || !activeSession}
                className="h-10 rounded-xl"
              />

              <button
                type="button"
                onClick={props.onClose}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                title="Close"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="border-b border-border px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="truncate text-xs text-muted-foreground">
              Route:{" "}
              <span className="font-medium text-foreground">
                {location.pathname}
              </span>
            </div>
            <PollingStatus run={run} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-3 rounded-[28px] border border-border bg-background/60 p-4">
            {displayMessages.length ? (
              displayMessages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div className="relative max-w-[82%] min-w-0">
                    <div
                      className={[
                        "min-w-0 overflow-hidden rounded-[24px] px-4 py-3 text-sm shadow-sm",
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "border border-border bg-card text-card-foreground",
                      ].join(" ")}
                    >
                      {message.role === "user" ? (
                        <div className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
                          {message.content}
                        </div>
                      ) : (
                        <ChatMessageContent html={message.content} />
                      )}

                      {message.role === "assistant" ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <CopyButton
                            iconOnly={true}
                            title="Copy to clipboard"
                            onClick={() => void handleCopy(message.content)}
                            className="h-8 rounded-lg text-xs"
                          />

                          {(pageType === "case" ||
                            pageType === "alert" ||
                            pageType === "hunt") &&
                          typeof message.metadata?.run_id === "string" ? (
                            <SendButton
                              iconOnly={true}
                              title={pageType === "hunt" ? "Add note" : "Post as comment"}
                              onClick={() =>
                                void handlePostAssistantMessage(
                                  message.metadata!.run_id as string
                                )
                              }
                              disabled={postingRunId === message.metadata?.run_id}
                              className="h-8 rounded-lg text-xs"
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-5 text-xs text-muted-foreground">
                Ask anything about the current case, alert, hunt, dashboard or
                audit context.
              </div>
            )}

            {isGenerating ? <RunThinkingBlock run={run} /> : null}

            {run?.error_message ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {run.error_message}
              </div>
            ) : null}

            <div ref={messagesEndRef} />
            <div ref={endRef} />
          </div>
        </div>

        <div className="border-t border-border px-5 py-4">
        <div className="space-y-3">
          <div className="relative">
            <ChatCommandMenu
              open={commandMenuOpen}
              query={prompt}
              actions={chatActions}
              activeIndex={commandActiveIndex}
              onSelect={(action) => {
                setPrompt(`${action.chat_command} `);
                setCommandMenuOpen(false);
                setCommandActiveIndex(0);
              }}
            />

            <textarea
              value={prompt}
              onChange={(e) => {
                const next = e.target.value;
                setPrompt(next);
                const opens = next.trimStart().startsWith("/");
                setCommandMenuOpen(opens);
                setCommandActiveIndex(0);
              }}
              onKeyDown={handlePromptKeyDown}
              rows={3}
              placeholder="Ask the assistant about the current page or launch a controlled analysis."
              className="min-h-[96px] max-h-[200px] w-full resize-none rounded-[24px] border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] text-muted-foreground">
                Enter to send · Shift+Enter for a new line
              </div>

              <SendButton
                iconOnly={false}
                type="button"
                onClick={() => void handleSend()}
                disabled={isGenerating || !prompt.trim()}
                className="rounded-xl"
                title={isGenerating ? "Sending..." : "Send"}
              />
              {isGenerating ? (
                <CancelButton
                  type="button"
                  onClick={() => void handleCancelRun()}
                  disabled={!!run?.cancel_requested}
                  title={run?.cancel_requested ? "Cancelling..." : "Cancel run"}
                >
                  {run?.cancel_requested ? "Cancelling..." : "Cancel"}
                </CancelButton>
              ) : null}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}