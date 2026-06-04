import { useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "../contexts/MeContext";
import Card from "../components/ui/Card";
import { useToast } from "../components/ui/toast";
import {
  archiveChatSession,
  ChatMessage,
  ChatRun,
  ChatSession,
  createChatRun,
  createChatSession,
  fetchChatRun,
  listChatSessions,
  cancelChatRun,
} from "../api/chat";
import { getClientTabId, makeRequestId } from "../auth/clientTab";
import {
  SendButton,
  CopyButton,
  DeleteButton,
  ClearButton,
} from "../components/ui/IconButton";
import TiptapRenderedContent from "../components/ui/TiptapRenderedContent";
import ChatMessageContent from "../components/chat/ChatMessageContent";

function FieldLabel({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </div>
  );
}

function StatPill({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

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
  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canUseChat = can("chat.use");
  const canUseChatLlm = can("chat.llm.use");

  const clientTabId = useMemo(() => getClientTabId(), []);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [prompt, setPrompt] = useState("");
  const [run, setRun] = useState<ChatRun | null>(null);
  const [busy, setBusy] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [clearing, setClearing] = useState(false);

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
    void (async () => {
      if (!canUseChat) return;
      try {
        const items = await listChatSessions();
        const dedicatedItems = items.filter(
          (item) => item.surface === "dedicated"
        );

        if (dedicatedItems.length > 0) {
          setActiveSession(dedicatedItems[0]);
          return;
        }

        const created = await createChatSession({
          title: "New chat",
          surface: "dedicated",
          client_tab_id: clientTabId,
        });

        setActiveSession(created);
      } catch (e: any) {
        toast.push({
          kind: "error",
          title: "Chat",
          message: e?.message || "Unable to load chat session",
        });
      }
    })();
  }, [clientTabId, toast]);

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
              (m) => m.role === "assistant" && m.metadata?.run_id === refreshed.id
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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeSession?.messages?.length, run?.status]);

  async function handleClearConversation() {
    if (!canUseChat) return;
    if (!activeSession) return;

    setClearing(true);
    try {
      await archiveChatSession(activeSession.id);

      const created = await createChatSession({
        title: "New chat",
        surface: "dedicated",
        client_tab_id: clientTabId,
      });

      setActiveSession(created);
      setRun(null);
      setPrompt("");

      toast.push({
        kind: "success",
        title: "Chat",
        message: "Conversation cleared",
      });
    } catch (e: any) {
      toast.push({
        kind: "error",
        title: "Chat",
        message: e?.message || "Unable to clear conversation",
      });
    } finally {
      setClearing(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 30);

    return () => window.clearTimeout(timer);
  }, [displayMessages.length, run?.error_message, run?.status]);

  function handlePromptKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isGenerating && canUseChatLlm && prompt.trim()) {
        void handleSend();
      }
    }
  }

  async function handleSend() {
    if (!activeSession || !prompt.trim() || !canUseChatLlm) return;

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
        title: "Chat",
        message: e?.message || "Unable to send message",
      });
    } finally {
      setBusy(false);
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
    <div className="space-y-2">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Catbot
          </h1>
        </div>

      </div>

      <Card className="p-5">
        <div className="mb-1 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">
              Conversation
            </div>
          </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatPill>
            {displayMessages.length} message{displayMessages.length > 1 ? "s" : ""}
          </StatPill>
          <PollingStatus run={run} />
          <ClearButton
            type="button"
            onClick={() => void handleClearConversation()}
            disabled={clearing || !canUseChat || !activeSession}
            title="Clear conversation"
          />
        </div>
        </div>

        <div className="flex h-[calc(100vh-240px)] min-h-[600px] flex-col gap-4">
          <div className="flex-1 overflow-hidden rounded-3xl border border-border bg-background">
            <div className="h-full overflow-y-auto p-4">
              <div className="space-y-4">
                {displayMessages.length === 0 ? (
                  <div className="flex h-full min-h-[280px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 px-6 text-center">
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        No messages yet
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

                <div ref={messagesEndRef} />
              </div>
            </div>
          </div>

          <div className="rounded-3xl p-1">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
              <FieldLabel>Prompt</FieldLabel>
              
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-2">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={handlePromptKeyDown}
                    rows={4}
                    disabled={!canUseChatLlm || isGenerating}
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
                      disabled={isGenerating || !canUseChatLlm || !prompt.trim()}
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
      </Card>
    </div>
  );
}