import { useEffect, useMemo, useRef, useState } from "react";
import Card from "../ui/Card";
import { useToast } from "../ui/toast";
import {
  cancelChatRun,
  createChatRun,
  createChatSession,
  fetchChatRun,
  ChatMessage,
  ChatRun,
  ChatSession,
} from "../../api/chat";
import { getClientTabId, makeRequestId } from "../../auth/clientTab";
import ChatMessageContent from "./ChatMessageContent";


export type ChatAssistantContext = {
  page_type: "dashboard" | "alert" | "case" | "hunt" | "task" | "audit";
  object_id?: string;
  customer_id?: string;
  current_tab?: string;
  inclusions?: string[];
};

function progressLabel(run: ChatRun | null) {
  const progress = (run?.provider_execution as any)?.ui_progress || {};
  if (run?.cancel_requested) return "Cancel in progress…";
  if (progress.label) return String(progress.label);
  if (run?.status === "queued") return "Queued…";
  if (run?.status === "running") return "Thinking…";
  return "";
}

function progressPreview(run: ChatRun | null) {
  return String(((run?.provider_execution as any)?.ui_progress || {}).preview || "").trim();
}

export default function ChatAssistantDrawer({
  open,
  onClose,
  context,
}: {
  open: boolean;
  onClose: () => void;
  context: ChatAssistantContext;
}) {
  const toast = useToast();
  const clientTabId = useMemo(() => getClientTabId(), []);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [prompt, setPrompt] = useState("");
  const [run, setRun] = useState<ChatRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);

  const isGenerating =
    busy ||
    run?.status === "queued" ||
    run?.status === "running" ||
    !!run?.cancel_requested;

  useEffect(() => {
    if (!run || !["queued", "running"].includes(run.status)) return;

    const timer = window.setInterval(async () => {
      try {
        const refreshed = await fetchChatRun(run.id);
        setRun(refreshed);

        if (
          refreshed.status === "completed" &&
          refreshed.response_text &&
          !messages.some(
            (message) =>
              message.role === "assistant" &&
              message.metadata?.run_id === refreshed.id
          )
        ) {
          setMessages((prev) => [
            ...prev,
            {
              id: `run-${refreshed.id}`,
              role: "assistant",
              content: refreshed.response_text,
              created_at: refreshed.completed_at || new Date().toISOString(),
              metadata: { run_id: refreshed.id },
            },
          ]);
        }

        if (["completed", "failed", "cancelled"].includes(refreshed.status)) {
          window.clearInterval(timer);
        }
      } catch {
        window.clearInterval(timer);
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [run?.id, run?.status, messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, run?.status, run?.cancel_requested]);

  if (!open) return null;

  async function ensureSession() {
    if (session) return session;

    const created = await createChatSession({
      title: `${context.page_type} assistant`,
      surface: "contextual",
      page_type: context.page_type,
      object_id: context.object_id,
      customer_id: context.customer_id,
      client_tab_id: clientTabId,
    });

    setSession(created);
    return created;
  }

  async function handleSend() {
    if (!prompt.trim()) return;

    const message = prompt.trim();
    const requestId = makeRequestId();

    setPrompt("");
    setBusy(true);

    setMessages((prev) => [
      ...prev,
      {
        id: `tmp-${requestId}`,
        role: "user",
        content: message,
        created_at: new Date().toISOString(),
        metadata: { request_id: requestId },
      },
    ]);

    try {
      const currentSession = await ensureSession();
      const createdRun = await createChatRun(currentSession.id, {
        client_tab_id: clientTabId,
        request_id: requestId,
        message,
        page_type: context.page_type,
        object_id: context.object_id,
        current_tab: context.current_tab,
        inclusions: context.inclusions || [],
        customer_id: context.customer_id,
      });

      setRun(createdRun);
    } catch (e: any) {
      setPrompt(message);
      setMessages((prev) => prev.filter((item) => item.id !== `tmp-${requestId}`));

      toast.push({
        kind: "error",
        title: "Assistant",
        message: e?.message || "Unable to send request",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
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

    setMessages((prev) => [
      ...prev,
      {
        id: `cancel-${run.id}-${Date.now()}`,
        role: "assistant",
        content: "Cancel in progress…",
        created_at: new Date().toISOString(),
        metadata: {
          run_id: run.id,
          message_kind: "cancel_progress",
        },
      },
    ]);

    try {
      const cancelled = await cancelChatRun(run.id);
      setRun(cancelled);
    } catch (e: any) {
      toast.push({
        kind: "error",
        title: "Assistant",
        message: e?.message || "Unable to cancel request",
      });
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl border-l bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Assistant</div>
          <div className="text-xs text-gray-500">{context.page_type}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-xs">
          Close
        </button>
      </div>

      <div className="space-y-4 p-4">
        <Card>
          <div className="text-xs text-gray-500">Snapshot context</div>
          <div className="mt-2 text-sm text-gray-800">
            page_type={context.page_type}
            {context.object_id ? ` • object_id=${context.object_id}` : ""}
            {context.current_tab ? ` • tab=${context.current_tab}` : ""}
          </div>
        </Card>

        <div className="space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={[
                  "max-w-[82%] min-w-0 overflow-hidden rounded-2xl px-4 py-3 text-sm",
                  message.role === "user"
                    ? "bg-gray-900 text-white"
                    : "border bg-white text-gray-800",
                ].join(" ")}
              >
                {message.role === "user" ? (
                  <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {message.content}
                  </div>
                ) : (
                  <ChatMessageContent html={message.content} />
                )}
              </div>
            </div>
          ))}

          {isGenerating ? (
            <div className="flex justify-start">
              <details className="max-w-[82%] min-w-0 rounded-2xl border bg-white px-4 py-3 text-sm">
                <summary className="cursor-pointer list-none text-xs text-gray-500">
                  {progressLabel(run)}
                </summary>
                <div className="mt-3 whitespace-pre-wrap break-words border-t pt-3 text-xs text-gray-500 [overflow-wrap:anywhere]">
                  {progressPreview(run) || "No preview available. This is not streaming."}
                </div>
              </details>
            </div>
          ) : null}

          <div ref={endRef} />
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          disabled={isGenerating}
          className="w-full rounded-2xl border px-4 py-3 text-sm outline-none disabled:opacity-60"
          placeholder="Summarize this object, explain an IOC, or prepare a draft comment."
        />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={isGenerating || !prompt.trim()}
            className="rounded-2xl bg-gray-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            Send
          </button>

          {isGenerating ? (
            <button
              type="button"
              onClick={() => void handleCancel()}
              disabled={!!run?.cancel_requested}
              className="rounded-2xl border px-4 py-3 text-sm font-medium disabled:opacity-50"
            >
              {run?.cancel_requested ? "Cancelling..." : "Cancel"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}