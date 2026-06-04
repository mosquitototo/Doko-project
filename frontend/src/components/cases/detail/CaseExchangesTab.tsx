import { useMemo } from "react";
import Card from "../../ui/Card";
import ConfirmDialog from "../../ui/ConfirmDialog";
import ConfirmDialogWide from "../../ui/ConfirmDialogWide";
import TiptapEditor from "../../ui/TiptapEditor";
import TiptapRenderedContent from "../../ui/TiptapRenderedContent";
import { CancelButton, ClearButton, DeleteButton, DetailButton, NewGenButton, RefreshButton, ReplyAllButton, ReplyButton, SaveButton, SendButton, ChevronDown, ChevronUp } from "../../ui/IconButton";
import type { CaseExchange } from "../../../api/exchanges";
import type { CaseExchangeQuickpart } from "../../../api/settingsCaseExchange";
import { deleteCaseExchange, updateCaseExchange } from "../../../api/exchanges";
import { formatDate, isRichTextEmpty, parseCsv } from "./utils";
import { createPortal } from "react-dom";

type Draft = {
  direction: "inbound" | "outbound";
  channel: "email" | "other";
  sender: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  message_id: string;
  references: string;
};

type ViewDraft = {
  channel: string;
  sender: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  message_id: string;
  references: string;
};

type BulkDraft = {
  direction: "outbound";
  channel: CaseExchange["channel"];
  sender: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  message_id: string;
};

type Props = {
  busy: boolean;
  canUpdateCase: boolean;
  exchangesBusy: boolean;
  setExchangesBusy: React.Dispatch<React.SetStateAction<boolean>>;
  exchanges: CaseExchange[];
  refreshExchanges: () => Promise<void>;
  openAddExchange: () => void;
  selectedExchangeIds: Record<string, boolean>;
  setSelectedExchangeIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  toggleSelectExchange: (id: string) => void;
  openBulkReplyModal: () => void;
  bulkDeleteSelected: () => Promise<void>;
  openReplyModal: (x: CaseExchange) => void;
  openDetails: (x: CaseExchange) => void;
  exchangeView: CaseExchange | null;
  setExchangeView: React.Dispatch<React.SetStateAction<CaseExchange | null>>;
  exchangeViewDraft: ViewDraft;
  setExchangeViewDraft: React.Dispatch<React.SetStateAction<ViewDraft>>;
  replyModalOpen: boolean;
  closeReplyModal: () => void;
  replyTarget: CaseExchange | null;
  exchangeDraft: Draft;
  setExchangeDraft: React.Dispatch<React.SetStateAction<Draft>>;
  saveReplyDraftToConversationOnly: () => Promise<void>;
  exchangeCreateOpen: boolean;
  setExchangeCreateOpen: React.Dispatch<React.SetStateAction<boolean>>;
  replyTo: CaseExchange | null;
  quickparts: CaseExchangeQuickpart[];
  quickpartsBusy: boolean;
  selectedQuickpartId: string;
  applyQuickpartToBody: (id: string) => void;
  onCreateExchange: () => Promise<void>;
  autoFollowupEnabled: boolean;
  setAutoFollowupEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  autoFollowupDelayValue: string;
  setAutoFollowupDelayValue: React.Dispatch<React.SetStateAction<string>>;
  autoFollowupDelayUnit: "minute" | "hour" | "day" | "week" | "month";
  setAutoFollowupDelayUnit: React.Dispatch<
    React.SetStateAction<"minute" | "hour" | "day" | "week" | "month">
  >;
  autoFollowupQuickpartId: string;
  setAutoFollowupQuickpartId: React.Dispatch<React.SetStateAction<string>>;
  autoFollowupOpen: boolean;
  setAutoFollowupOpen: React.Dispatch<React.SetStateAction<boolean>>;
  saveAutoFollowupSettings: () => Promise<void>;
  autoFollowupAction: "save" | "send";
  setAutoFollowupAction: React.Dispatch<React.SetStateAction<"save" | "send">>;
  onSendExchange: () => Promise<void>;
  followupSelectionOpen: boolean;
  setFollowupSelectionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  followupSelectionAction: "save" | "send";
  setFollowupSelectionAction: React.Dispatch<React.SetStateAction<"save" | "send">>;
  configureSelectedFollowups: () => Promise<void>;
  disableSelectedFollowups: () => Promise<void>;
  bulkReplyOpen: boolean;
  sendBulkReplyIndividually: () => Promise<void>;
  setBulkReplyOpen: React.Dispatch<React.SetStateAction<boolean>>;
  bulkReplyTargets: CaseExchange[];
  bulkRecipients: string[];
  bulkReplyDraft: BulkDraft;
  setBulkReplyDraft: React.Dispatch<React.SetStateAction<BulkDraft>>;
  saveBulkReplyConversationOnly: () => Promise<void>;
  push: (toast: { kind: "success" | "error" | "info"; title: string; message?: string }) => void;
};

export default function CaseExchangesTab(props: Props) {
  const selectedExchanges = useMemo(
    () => props.exchanges.filter((x) => !!props.selectedExchangeIds?.[x.id]),
    [props.exchanges, props.selectedExchangeIds]
  );

  const selectedCount = selectedExchanges.length;

  const selectedFollowupEnabledCount = useMemo(
    () => selectedExchanges.filter((x) => !!x.followup_config?.enabled).length,
    [selectedExchanges]
  );

  const selectionHasOnlyFollowups =
    selectedCount > 0 && selectedFollowupEnabledCount === selectedCount;

  return (
    <>
      <div className="space-y-6">

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-foreground">Exchanges</div>
              <div className="text-xs text-muted-foreground">Conversation history and outbound drafts for this case</div>
            </div>

            <div className="flex items-center gap-2">
              <RefreshButton onClick={() => void props.refreshExchanges()} disabled={props.busy || props.exchangesBusy} title="Refresh messages">
                {props.exchangesBusy ? "Refreshing…" : "Refresh"}
              </RefreshButton>

              <NewGenButton onClick={props.openAddExchange} disabled={props.busy || props.exchangesBusy || !props.canUpdateCase} title="Add message" iconOnly={false} label="Add exchange" />
            </div>
          </div>

          <div className="mt-4">
            {props.exchanges.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-10 text-center">
                <div className="text-sm font-medium text-foreground">No exchanges yet</div>
                <div className="mt-1 text-xs text-muted-foreground">Email-style conversation items will appear here.</div>
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-background/40 p-3 sm:p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">{selectedCount} selected</div>

                  <div className="flex flex-wrap items-center gap-2">
                    <ReplyAllButton disabled={props.busy || props.exchangesBusy || !props.canUpdateCase || selectedCount === 0} onClick={props.openBulkReplyModal} title="Reply to each selected message">
                      Reply all
                    </ReplyAllButton>

                    <NewGenButton
                      disabled={props.busy || props.exchangesBusy || !props.canUpdateCase || selectedCount === 0}
                      onClick={() => {
                        if (selectionHasOnlyFollowups) {
                          void props.disableSelectedFollowups();
                          return;
                        }
                        props.setFollowupSelectionOpen(true);
                      }}
                      title={selectionHasOnlyFollowups ? "Disable follow-up for selected messages" : "Enable follow-up for selected messages"}
                      iconOnly={false}
                      label={selectionHasOnlyFollowups ? "Disable follow-up" : "Enable follow-up"}
                    />

                    <DeleteButton disabled={props.busy || props.exchangesBusy || !props.canUpdateCase || selectedCount === 0} onClick={() => void props.bulkDeleteSelected()} title="Delete selected messages" />
                    <ClearButton disabled={props.busy || props.exchangesBusy || selectedCount === 0} onClick={() => props.setSelectedExchangeIds({})} title="Clear selection" />
                  </div>
                </div>

                <div className="max-h-[1200px] space-y-4 overflow-auto pr-1">
                  {props.exchanges
                    .slice()
                    .sort((a, b) => (Date.parse(String(a.created_at ?? "")) || 0) - (Date.parse(String(b.created_at ?? "")) || 0))
                    .map((x, idx, arr) => {
                      const isOutbound = String(x.direction) === "outbound";
                      const prev = idx > 0 ? arr[idx - 1] : null;
                      const sameDay =
                        prev &&
                        new Date(String(prev.created_at || 0)).toDateString() === new Date(String(x.created_at || 0)).toDateString();
                      const checked = !!(props.selectedExchangeIds || {})[x.id];
                      const followupEnabled = !!x.followup_config?.enabled;

                      return (
                        <div key={x.id} className="w-full">
                          {!sameDay ? (
                            <div className="my-2 flex items-center justify-center">
                              <span className="rounded-full border border-border bg-background px-3 py-1 text-[11px] font-medium text-muted-foreground">
                                {new Date(x.created_at).toLocaleDateString()}
                              </span>
                            </div>
                          ) : null}

                          <div className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
                            <div className={["group mt-2 w-[96%] sm:w-[90%] md:w-[82%] lg:w-[74%] xl:w-[68%]", isOutbound ? "ml-auto" : "mr-auto"].join(" ")}>
                              <div
                                className={[
                                  "rounded-3xl border px-4 py-3 shadow-sm transition",
                                  "hover:-translate-y-[1px] hover:shadow-md",
                                  isOutbound ? "border-slate-300 bg-slate-300 text-slate-900 dark:border-slate-800 dark:bg-slate-800 dark:text-white" : "border-border bg-card text-foreground",
                                ].join(" ")}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-start gap-2">
                                      <label
                                        className={[
                                          "inline-flex items-center justify-center rounded-md border p-1",
                                          "cursor-pointer select-none",
                                          isOutbound ? "border-slate-300 text-slate-700 dark:border-white/20 dark:text-white/80" : "border-border text-muted-foreground",
                                        ].join(" ")}
                                        title="Select message"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <input
                                          type="checkbox"
                                          className="cursor-pointer"
                                          checked={checked}
                                          disabled={props.busy || props.exchangesBusy}
                                          onChange={() => props.toggleSelectExchange(x.id)}
                                        />
                                      </label>

                                      <div className="min-w-0 flex-1">
                                        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px] leading-tight">
                                          <span className="font-semibold opacity-60">From:</span>
                                          <span className="truncate opacity-90">{isOutbound ? "You" : x.sender || "—"}</span>
                                          <span className="font-semibold opacity-60">To:</span>
                                          <span className="truncate opacity-90">{(Array.isArray(x.to) ? x.to.join(", ") : (x as any).to) || "—"}</span>
                                          <span className="font-semibold opacity-60">Subject:</span>
                                          <div className={["truncate font-medium", isOutbound ? "text-slate-900 dark:text-white" : "text-foreground"].join(" ")} onClick={(e) => e.stopPropagation()}>
                                            {x.subject ? String(x.subject) : <span className={isOutbound ? "italic text-slate-500 dark:text-white/50" : "italic text-muted-foreground"}>(no subject)</span>}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex shrink-0 flex-col items-end gap-1">
                                    <div className={["rounded-full border px-2 py-0.5 text-[9px] font-mono uppercase tracking-wide", isOutbound ? "border-slate-300 text-slate-600 dark:border-white/20 dark:text-white/70" : "border-border text-muted-foreground"].join(" ")}>
                                      {x.channel}
                                    </div>

                                    {followupEnabled ? (
                                      <button
                                        type="button"
                                        className={[
                                          "rounded-full border cursor-pointer px-2 py-0.5 text-[9px] font-medium transition hover:opacity-80",
                                          isOutbound
                                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                                            : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
                                        ].join(" ")}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          props.setSelectedExchangeIds({ [x.id]: true });
                                        }}
                                        title="Select this message to manage follow-up"
                                        disabled={props.busy || props.exchangesBusy}
                                      >
                                        Follow-up
                                      </button>
                                    ) : null}
                                  </div>
                                </div>

                                <div className={["mt-4 rounded-2xl border px-3 py-3 text-sm break-words", isOutbound ? "border-slate-200 bg-white/70 text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-white" : "border-border bg-background text-foreground"].join(" ")}>
                                  {isRichTextEmpty(String(x.body || "")) ? (
                                    <span className={isOutbound ? "text-slate-500 dark:text-white/60" : "text-muted-foreground"}>(empty)</span>
                                  ) : (
                                    <div className="min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_*]:break-words [&_*]:[overflow-wrap:anywhere] [&_a]:break-all [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_code]:whitespace-pre-wrap [&_code]:break-words [&_code]:[overflow-wrap:anywhere]">
                                      <TiptapRenderedContent
                                        html={String(x.body || "")}
                                        className="max-w-none"
                                      />
                                    </div>
                                  )}
                                </div>

                                <div className={["mt-3 flex flex-wrap items-center gap-2 text-[10px]", isOutbound ? "text-slate-600 dark:text-white/70" : "text-muted-foreground"].join(" ")}>
                                  <span>Created at {formatDate(x.created_at)}</span>
                                  <div className="ml-auto flex items-center gap-2">
                                    <ReplyButton onClick={() => props.openReplyModal(x)} disabled={props.busy || props.exchangesBusy || !props.canUpdateCase} title="Reply" />
                                    <DetailButton onClick={() => props.openDetails(x)} disabled={props.busy} title="Details" />
                                    <DeleteButton
                                      disabled={props.busy || props.exchangesBusy || !props.canUpdateCase}
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        const ok = window.confirm("Delete this message?");
                                        if (!ok) return;
                                        props.setExchangesBusy(true);
                                        try {
                                          await deleteCaseExchange(x.id);
                                          props.push({ kind: "success", title: "Deleted" });
                                          await props.refreshExchanges();
                                        } catch (err: any) {
                                          props.push({ kind: "error", title: "Error", message: String(err?.response?.data?.detail ?? err?.response?.status ?? "network") });
                                        } finally {
                                          props.setExchangesBusy(false);
                                        }
                                      }}
                                      title="Delete message"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

    {props.exchangeView
      ? createPortal(
          <div className="fixed inset-0 z-[110]">
            <button
              type="button"
              className="absolute inset-0 z-0 m-0 h-full w-full cursor-default appearance-none rounded-none border-0 bg-black/40 p-0 outline-none backdrop-blur-[2px]"
              onClick={() => props.setExchangeView(null)}
              aria-label="Close exchange"
              disabled={props.busy || props.exchangesBusy}
            />
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
              <div className="pointer-events-auto w-full max-w-3xl overflow-hidden rounded-3xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl">
                <div className="border-b border-border px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-lg font-semibold text-foreground">Exchange ({props.exchangeView.direction})</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">Exchange ID <span className="font-mono">{props.exchangeView.id}</span></div>
                    </div>
                    <CancelButton onClick={() => props.setExchangeView(null)} disabled={props.busy || props.exchangesBusy} title="Close" />
                  </div>
                </div>

                <div className="max-h-[78vh] overflow-auto px-5 py-5">
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Channel</label>
                        <select className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeViewDraft.channel} onChange={(e) => props.setExchangeViewDraft((p) => ({ ...p, channel: e.target.value as any }))} disabled={props.busy || props.exchangesBusy || !props.canUpdateCase}>
                          <option value="email">Email</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Message-ID</label>
                        <input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-mono outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeViewDraft.message_id} onChange={(e) => props.setExchangeViewDraft((p) => ({ ...p, message_id: e.target.value }))} disabled={props.busy || props.exchangesBusy || !props.canUpdateCase} />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">From</label>
                        <input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeViewDraft.sender} onChange={(e) => props.setExchangeViewDraft((p) => ({ ...p, sender: e.target.value }))} disabled={props.busy || props.exchangesBusy || !props.canUpdateCase} />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">To</label>
                        <input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeViewDraft.to} onChange={(e) => props.setExchangeViewDraft((p) => ({ ...p, to: e.target.value }))} disabled={props.busy || props.exchangesBusy || !props.canUpdateCase} />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Cc</label>
                        <input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeViewDraft.cc} onChange={(e) => props.setExchangeViewDraft((p) => ({ ...p, cc: e.target.value }))} disabled={props.busy || props.exchangesBusy || !props.canUpdateCase} />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Bcc</label>
                        <input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeViewDraft.bcc} onChange={(e) => props.setExchangeViewDraft((p) => ({ ...p, bcc: e.target.value }))} disabled={props.busy || props.exchangesBusy || !props.canUpdateCase} />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Subject</label>
                      <input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeViewDraft.subject} onChange={(e) => props.setExchangeViewDraft((p) => ({ ...p, subject: e.target.value }))} disabled={props.busy || props.exchangesBusy || !props.canUpdateCase} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">References</label>
                      <input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-mono outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeViewDraft.references} onChange={(e) => props.setExchangeViewDraft((p) => ({ ...p, references: e.target.value }))} disabled={props.busy || props.exchangesBusy || !props.canUpdateCase} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Body (HTML editor)</label>
                      <div className="rounded-2xl border border-border bg-background/40 p-3">
                        <TiptapEditor value={props.exchangeViewDraft.body} onChange={(v) => props.setExchangeViewDraft((p) => ({ ...p, body: v }))} disabled={props.busy || props.exchangesBusy || !props.canUpdateCase} placeholder="Write message body..." className="text-sm" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
                  <SaveButton
                    disabled={props.busy || props.exchangesBusy || !props.canUpdateCase}
                    onClick={async () => {
                      if (!props.canUpdateCase) return;
                      if (!props.exchangeView) return;
                      props.setExchangesBusy(true);
                      try {
                        await updateCaseExchange(props.exchangeView, {
                          channel: props.exchangeViewDraft.channel,
                          sender: props.exchangeViewDraft.sender,
                          to: parseCsv(props.exchangeViewDraft.to),
                          cc: parseCsv(props.exchangeViewDraft.cc),
                          bcc: parseCsv(props.exchangeViewDraft.bcc),
                          subject: props.exchangeViewDraft.subject,
                          body: props.exchangeViewDraft.body,
                          message_id: props.exchangeViewDraft.message_id,
                          references: parseCsv(props.exchangeViewDraft.references),
                        } as any);
                        await props.refreshExchanges();
                        props.push({ kind: "success", title: "Exchange updated" });
                        props.setExchangeView(null);
                      } catch (err: any) {
                        props.push({ kind: "error", title: "Error", message: String(err?.response?.data?.detail ?? err?.response?.status ?? "network") });
                      } finally {
                        props.setExchangesBusy(false);
                      }
                    }}
                    title="Save exchange"
                  >
                    {props.exchangesBusy ? "Saving…" : "Save"}
                  </SaveButton>
                  <SendButton disabled title="Send is available from the compose window" />
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null}

      {props.replyModalOpen
        ? createPortal(
          <div className="fixed inset-0 z-[110]">
          <button
            type="button"
            className="absolute inset-0 z-0 m-0 h-full w-full cursor-default appearance-none rounded-none border-0 bg-black/40 p-0 outline-none backdrop-blur-[2px]"
            onClick={props.closeReplyModal}
            aria-label="Close reply"
            disabled={props.busy || props.exchangesBusy}
          />
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
            <div className="pointer-events-auto w-full max-w-3xl overflow-hidden rounded-3xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl">
              <div className="border-b border-border px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold text-foreground">Reply</div>
                    {props.replyTarget ? <div className="mt-1 text-[11px] text-muted-foreground">Replying to <span className="font-mono">{props.replyTarget.id}</span></div> : null}
                  </div>
                  <CancelButton onClick={props.closeReplyModal} disabled={props.busy || props.exchangesBusy} title="Close" />
                </div>
              </div>
              <div className="max-h-[78vh] overflow-auto px-5 py-5">
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Direction</label><select className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.direction} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, direction: e.target.value as any }))} disabled={props.busy || props.exchangesBusy}><option value="outbound">Outbound</option><option value="inbound">Inbound</option></select></div>
                    <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Channel</label><select className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.channel} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, channel: e.target.value as any }))} disabled={props.busy || props.exchangesBusy}><option value="email">Email</option><option value="other">Other</option></select></div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Sender</label><input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.sender} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, sender: e.target.value }))} disabled={props.busy || props.exchangesBusy} /></div>
                    <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">To (comma separated)</label><input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.to} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, to: e.target.value }))} disabled={props.busy || props.exchangesBusy} /></div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Cc</label><input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.cc} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, cc: e.target.value }))} disabled={props.busy || props.exchangesBusy} /></div>
                    <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Bcc</label><input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.bcc} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, bcc: e.target.value }))} disabled={props.busy || props.exchangesBusy} /></div>
                  </div>
                  <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Subject</label><input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.subject} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, subject: e.target.value }))} disabled={props.busy || props.exchangesBusy} /></div>
                  <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Quickpart</label><select className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.selectedQuickpartId} onChange={(e) => props.applyQuickpartToBody(e.target.value)} disabled={props.busy || props.exchangesBusy || props.quickpartsBusy}><option value="">{props.quickpartsBusy ? "Loading…" : "Select a quickpart"}</option>{props.quickparts.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}</select></div>
                  <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Body (HTML editor)</label><div className="rounded-2xl border border-border bg-background/40 p-3"><TiptapEditor value={props.exchangeDraft.body} onChange={(v) => props.setExchangeDraft((p) => ({ ...p, body: v }))} disabled={props.busy || props.exchangesBusy} placeholder="Write message body..." className="text-sm" /></div></div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Message-ID</label><input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-mono outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.message_id} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, message_id: e.target.value }))} disabled={props.busy || props.exchangesBusy} /></div>
                    <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">References</label><input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-mono outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.references} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, references: e.target.value }))} disabled={props.busy || props.exchangesBusy} /></div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
                <SaveButton disabled={props.busy || props.exchangesBusy || !props.canUpdateCase} title="Save message" onClick={() => void props.saveReplyDraftToConversationOnly()}>{props.exchangesBusy ? "Saving…" : "Save"}</SaveButton>
                <SendButton
                  disabled={props.busy || props.exchangesBusy || !props.canUpdateCase}
                  title="Send message"
                  onClick={() => void props.onSendExchange()}
                />
              </div>
            </div>
          </div>
          </div>,
          document.body
        )
      : null}

      {props.exchangeCreateOpen
        ? createPortal(
            <div className="fixed inset-0 z-[110]">
              <button
                type="button"
                className="absolute inset-0 z-0 m-0 h-full w-full cursor-default appearance-none rounded-none border-0 bg-black/40 p-0 outline-none backdrop-blur-[2px]"
                onClick={() => {
                  if (!(props.exchangesBusy || props.busy)) {
                    props.setExchangeCreateOpen(false);
                  }
                }}
                aria-label="Close add exchange"
                disabled={props.busy || props.exchangesBusy}
              />

          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
            <div className="pointer-events-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl">
              <div className="border-b border-border px-5 py-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-lg font-semibold text-foreground">{props.replyTo ? "Reply" : "Add exchange"}</div>{props.replyTo ? <div className="mt-1 text-[11px] text-muted-foreground">Replying to <span className="font-mono">{props.exchangeDraft.to}</span></div> : null}</div><CancelButton onClick={() => props.setExchangeCreateOpen(false)} disabled={props.busy || props.exchangesBusy} title="Close" /></div></div>
              <div className="max-h-[78vh] overflow-auto px-5 py-5">
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Direction</label><select className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.direction} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, direction: e.target.value as any }))} disabled={props.busy || props.exchangesBusy}><option value="outbound">Outbound</option><option value="inbound">Inbound</option></select></div>
                    <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Channel</label><select className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.channel} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, channel: e.target.value as any }))} disabled={props.busy || props.exchangesBusy}><option value="email">Email</option><option value="other">Other</option></select></div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Sender</label><input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.sender} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, sender: e.target.value }))} disabled={props.busy || props.exchangesBusy} /></div>
                    <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">To (comma separated)</label><input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.to} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, to: e.target.value }))} disabled={props.busy || props.exchangesBusy} /></div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Cc</label><input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.cc} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, cc: e.target.value }))} disabled={props.busy || props.exchangesBusy} /></div>
                    <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Bcc</label><input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.bcc} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, bcc: e.target.value }))} disabled={props.busy || props.exchangesBusy} /></div>
                  </div>
                  <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Subject</label><input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.subject} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, subject: e.target.value }))} disabled={props.busy || props.exchangesBusy} /></div>
                  <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Quickpart</label><select className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.selectedQuickpartId} onChange={(e) => props.applyQuickpartToBody(e.target.value)} disabled={props.busy || props.exchangesBusy || props.quickpartsBusy}><option value="">{props.quickpartsBusy ? "Loading…" : "Select a quickpart"}</option>{props.quickparts.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}</select></div>
                  <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Body (HTML editor)</label><div className="rounded-2xl border border-border bg-background/40 p-3"><TiptapEditor value={props.exchangeDraft.body} onChange={(v) => props.setExchangeDraft((p) => ({ ...p, body: v }))} disabled={props.busy || props.exchangesBusy} placeholder="Write message body..." className="text-sm" /></div></div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Message-ID</label><input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-mono outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.message_id} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, message_id: e.target.value }))} disabled={props.busy || props.exchangesBusy} /></div>
                    <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">References</label><input className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-mono outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={props.exchangeDraft.references} onChange={(e) => props.setExchangeDraft((p) => ({ ...p, references: e.target.value }))} disabled={props.busy || props.exchangesBusy} /></div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
                <SaveButton disabled={props.busy || props.exchangesBusy} onClick={() => void props.onCreateExchange()} title="Save message">{props.exchangesBusy ? "Saving…" : "Add"}</SaveButton>
                <SendButton
                  disabled={props.busy || props.exchangesBusy || !props.canUpdateCase}
                  title="Send message"
                  onClick={() => void props.onSendExchange()}
                />
              </div>
            </div>
          </div>
        </div>,
          document.body
        )
      : null}

      {props.bulkReplyOpen
        ? createPortal(
          <div className="fixed inset-0 z-[110]">
          <button
            type="button"
            className="absolute inset-0 z-0 m-0 h-full w-full cursor-default appearance-none rounded-none border-0 bg-black/40 p-0 outline-none backdrop-blur-[2px]"
            onClick={() => props.setBulkReplyOpen(false)}
            aria-label="Close bulk reply"
            disabled={props.busy || props.exchangesBusy}
          />
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
            <div className="pointer-events-auto flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl">
              <div className="border-b border-border px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold text-foreground">Bulk Reply</div>
                    <div className="mt-1 break-words text-[10px] italic text-muted-foreground">
                      {props.bulkReplyTargets.length} message(s) selected — one reply per message
                    </div>
                  </div>
                  <CancelButton onClick={() => props.setBulkReplyOpen(false)} disabled={props.busy || props.exchangesBusy} />
                </div>
              </div>
              <div className="flex-1 overflow-auto px-5 py-5">
              <div className="rounded-2xl border border-border bg-background/50 p-3">
                <div className="mb-2 text-xs font-semibold text-foreground">
                  {props.bulkRecipients.length} recipient(s) selected
                </div>
              </div>
                <div className="max-h-[120px] overflow-auto rounded-2xl border border-border bg-card p-2 text-xs font-mono text-foreground">
                  {props.bulkRecipients.length ? (
                    props.bulkRecipients.map((r) => (
                      <div key={r} className="truncate">
                        {r}
                      </div>
                    ))
                  ) : (
                    <div className="italic text-muted-foreground">—</div>
                  )}
                </div>
              </div>
                <div className="max-h-[78vh] space-y-4 overflow-auto px-5 py-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Channel
                      </label>
                      <select
                        className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                        value={props.bulkReplyDraft.channel}
                        onChange={(e) =>
                          props.setBulkReplyDraft((p) => ({ ...p, channel: e.target.value as any }))
                        }
                        disabled={props.busy || props.exchangesBusy}
                      >
                        <option value="email">Email</option>
                        <option value="other">Other</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Sender
                      </label>
                      <input
                        className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                        value={props.bulkReplyDraft.sender}
                        onChange={(e) =>
                          props.setBulkReplyDraft((p) => ({ ...p, sender: e.target.value }))
                        }
                        disabled={props.busy || props.exchangesBusy}
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Cc
                      </label>
                      <input
                        className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                        value={props.bulkReplyDraft.cc}
                        onChange={(e) =>
                          props.setBulkReplyDraft((p) => ({ ...p, cc: e.target.value }))
                        }
                        disabled={props.busy || props.exchangesBusy}
                        placeholder="(optional) — multiple selected"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Bcc
                      </label>
                      <input
                        className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                        value={props.bulkReplyDraft.bcc}
                        onChange={(e) =>
                          props.setBulkReplyDraft((p) => ({ ...p, bcc: e.target.value }))
                        }
                        disabled={props.busy || props.exchangesBusy}
                        placeholder="(optional) — multiple selected"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Subject
                    </label>
                    <input
                      className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                      value={props.bulkReplyDraft.subject}
                      onChange={(e) =>
                        props.setBulkReplyDraft((p) => ({ ...p, subject: e.target.value }))
                      }
                      disabled={props.busy || props.exchangesBusy}
                      placeholder="(optional) — otherwise uses Re: <original subject>"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Body
                    </label>
                    <div className="rounded-2xl border border-border bg-background/40 p-3">
                      <TiptapEditor
                        value={props.bulkReplyDraft.body}
                        onChange={(v) =>
                          props.setBulkReplyDraft((p) => ({ ...p, body: v }))
                        }
                        disabled={props.busy || props.exchangesBusy}
                        placeholder="Write message body..."
                        className="text-sm text-foreground"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Message-ID
                    </label>
                    <input
                      className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-mono text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                      value={props.bulkReplyDraft.message_id}
                      onChange={(e) =>
                        props.setBulkReplyDraft((p) => ({ ...p, message_id: e.target.value }))
                      }
                      disabled={props.busy || props.exchangesBusy}
                      placeholder="(optional) — multiple selected"
                    />
                  </div>
                </div>
                <div className="border-t border-border px-5 py-4">
                  <div className="flex flex-row items-center justify-end gap-2">
                  <SaveButton title="Save message" disabled={props.busy || props.exchangesBusy || !props.canUpdateCase} onClick={() => void props.saveBulkReplyConversationOnly()}>{props.exchangesBusy ? "Saving…" : "Save"}</SaveButton>
                  <SendButton
                    disabled={props.busy || props.exchangesBusy || !props.canUpdateCase || props.bulkReplyTargets.length === 0}
                    title="Send one reply per selected message"
                    onClick={() => void props.sendBulkReplyIndividually()}
                  />
                  </div></div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null}

      {props.followupSelectionOpen
        ? createPortal(
            <div className="fixed inset-0 z-[110]">
            <button
              type="button"
              className="absolute inset-0 z-0 m-0 h-full w-full cursor-default appearance-none rounded-none border-0 bg-black/40 p-0 outline-none backdrop-blur-[2px]"
              onClick={() => props.setFollowupSelectionOpen(false)}
              aria-label="Close follow-up configuration"
              disabled={props.busy || props.exchangesBusy}
            />
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
              <div className="pointer-events-auto w-full max-w-xl overflow-hidden rounded-3xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl">
              <div className="border-b border-border px-5 py-4">
                <div className="text-lg font-semibold text-foreground">Enable follow-up</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Configure follow-up for {selectedCount} selected message(s).
                </div>                
              </div>
              <div className="space-y-4 px-5 py-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Delay
                    </label>
                    <input
                      type="number"
                      min={1}
                      className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                      value={props.autoFollowupDelayValue}
                      onChange={(e) => props.setAutoFollowupDelayValue(e.target.value)}
                      disabled={props.busy || props.exchangesBusy}
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Unit
                    </label>
                    <select
                      className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                      value={props.autoFollowupDelayUnit}
                      onChange={(e) => props.setAutoFollowupDelayUnit(e.target.value as any)}
                      disabled={props.busy || props.exchangesBusy}
                    >
                      <option value="minute">Minute(s)</option>
                      <option value="hour">Hour(s)</option>
                      <option value="day">Day(s)</option>
                      <option value="week">Week(s)</option>
                      <option value="month">Month(s)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Quickpart
                  </label>
                  <select
                    className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                    value={props.autoFollowupQuickpartId}
                    onChange={(e) => props.setAutoFollowupQuickpartId(e.target.value)}
                    disabled={props.busy || props.exchangesBusy || props.quickpartsBusy}
                  >
                    <option value="">{props.quickpartsBusy ? "Loading…" : "No quickpart"}</option>
                    {props.quickparts.map((q) => (
                      <option key={q.id} value={q.id}>{q.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Action
                  </label>
                  <select
                    className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                    value={props.followupSelectionAction}
                    onChange={(e) => props.setFollowupSelectionAction(e.target.value as "save" | "send")}
                    disabled={props.busy || props.exchangesBusy}
                  >
                    <option value="save">Save only</option>
                    <option value="send">Send</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
                <SaveButton
                  disabled={
                    props.busy ||
                    props.exchangesBusy ||
                    !props.canUpdateCase ||
                    selectedCount < 1 ||
                    !props.autoFollowupQuickpartId
                  }
                  onClick={() => void props.configureSelectedFollowups()}
                  title="Enable follow-up"
                >
                  {props.exchangesBusy ? "Saving…" : "Enable"}
                </SaveButton>
                <CancelButton
                  onClick={() => props.setFollowupSelectionOpen(false)}
                  disabled={props.busy || props.exchangesBusy}
                  title="Cancel"
                />
              </div>
            </div>
          </div>
          </div>,
          document.body
        )
      : null}
    </>
  );
}
