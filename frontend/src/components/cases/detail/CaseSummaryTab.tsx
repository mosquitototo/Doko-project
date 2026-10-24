import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import Card from "../../ui/Card";
import MarkdownEditor from "../../ui/MarkdownEditor";
import MarkdownRenderedContent from "../../ui/MarkdownRenderedContent";
import type { MarkdownLinkAction } from "../../ui/markdownLinks";
import UserAvatar from "../../ui/UserAvatar";
import { CancelButton, DeleteButton, EditGenButton, NewGenButton, OpenGenButton, SaveButton, UnMergeButton } from "../../ui/IconButton";
import type { Attachment, Comment, LinkedAlert, LinkedTask, WorkbookInstance } from "../../../api/caseDetail";
import type { WorkbookTemplate } from "../../../api/settingsWorkbooks";
import { formatDate, isRichTextEmpty } from "./utils";
import { resolveMediaUrl } from "../../../utils/mediaUrl";



type Props = {
  busy: boolean;
  canUpdateCase: boolean;
  editDescription: string;
  description: string;
  setEditDescription: React.Dispatch<React.SetStateAction<string>>;
  saveIfDirty: (description?: string) => Promise<boolean>;
  onDescriptionFocusChange?: (focused: boolean) => void;
  commentText: string;
  setCommentText: React.Dispatch<React.SetStateAction<string>>;
  submitComment: () => Promise<boolean>;
  comments: Comment[];
  editingCommentId: string | null;
  editingText: string;
  setEditingText: React.Dispatch<React.SetStateAction<string>>;
  commentBusyId: string | null;
  startEditComment: (c: Comment) => void;
  cancelEditComment: () => void;
  saveEditComment: (commentId: string, text?: string) => void | Promise<void>;
  removeComment: (commentId: string) => void;
  wbLoading: boolean;
  workbook: WorkbookInstance | null;
  wbTemplates: WorkbookTemplate[];
  wbBusyApply: boolean;
  wbBusyItemId: string | null;
  onApplyWorkbookTemplate: (nextTemplateId: string | null) => void | Promise<void>;
  onToggleWorkbookItem: (itemId: string, nextDone: boolean) => void | Promise<void>;
  linkedAlerts: LinkedAlert[];
  canUnmerge: boolean;
  setConfirmUnmerge: React.Dispatch<React.SetStateAction<{ id: string; title: string } | null>>;
  linkedTasks: LinkedTask[];
  canViewTasks: boolean;
  attachments: Attachment[];
  onUploadFile: (file: File) => void | Promise<void>;
  removeAttachment: (attachmentId: string) => void;
};

export default function CaseSummaryTab(props: Props) {
  const [descriptionActionsVisible, setDescriptionActionsVisible] = useState(false);
  const [linkAction, setLinkAction] = useState<{ target: string; request: MarkdownLinkAction } | null>(null);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [descriptionOverflow, setDescriptionOverflow] = useState(false);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const descriptionContentRef = useRef<HTMLDivElement | null>(null);
  const caseDescFocusedRef = useRef(false);

  useEffect(() => {
    const element = descriptionContentRef.current;
    if (!element) return;
    const measure = () => setDescriptionOverflow(element.scrollHeight > 384);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.description, descriptionActionsVisible]);

  useEffect(() => {
    if (caseDescFocusedRef.current) return;
    props.setEditDescription(props.description ?? "");
  }, [props.description]);

  function setDescriptionEditing(next: boolean) {
    caseDescFocusedRef.current = next;
    setDescriptionActionsVisible(next);
    props.onDescriptionFocusChange?.(next);
  }

  async function saveDescription() {
    if (await props.saveIfDirty(props.editDescription ?? "")) setDescriptionEditing(false);
  }

  async function publishNote() {
    if (await props.submitComment()) setNoteEditorOpen(false);
  }

  function cancelDescriptionEdit() {
    props.setEditDescription(props.description ?? "");
    setDescriptionEditing(false);
  }

  return (
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(280px,3fr)]">
      <div className="min-w-0 space-y-4">
      <Card className="min-w-0 p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-lg font-semibold text-foreground">Description</div>
            {descriptionActionsVisible ? (
              <div className="flex items-center gap-2">
                <SaveButton
                  onClick={() => void saveDescription()}
                  disabled={props.busy || !props.canUpdateCase || (props.editDescription ?? "") === (props.description ?? "")}
                  title="Save description"
                >
                  Save
                </SaveButton>
                <CancelButton
                  onClick={cancelDescriptionEdit}
                  disabled={props.busy || !props.canUpdateCase}
                  title="Cancel"
                />
              </div>
            ) : props.canUpdateCase ? <EditGenButton onClick={() => { setLinkAction(null); setDescriptionEditing(true); }} disabled={props.busy} title="Edit description" /> : null}
          </div>

          {descriptionActionsVisible ? <MarkdownEditor
            alwaysShowToolbar
            value={props.editDescription ?? ""}
            initialLinkAction={linkAction?.target === "description" ? linkAction.request : undefined}
            onChange={(v) => props.setEditDescription(v)}
            disabled={props.busy || !props.canUpdateCase}
            placeholder="Write a description..."
            className="text-sm"
          /> : <>
            <div className={descriptionExpanded ? "min-w-0" : "max-h-96 min-w-0 overflow-hidden"}>
              <div ref={descriptionContentRef} className="min-w-0 break-words [overflow-wrap:anywhere]">
                {props.description ? <MarkdownRenderedContent markdown={props.description} requireLinkModifier onEditLink={props.canUpdateCase && !props.busy ? request => {
                  props.setEditDescription(props.description ?? "");
                  setDescriptionEditing(true);
                  setLinkAction({ target: "description", request });
                } : undefined} /> : <span className="text-sm text-muted-foreground">No description</span>}
              </div>
            </div>
            {descriptionOverflow ? <button type="button" aria-expanded={descriptionExpanded} className="mx-auto mt-2 block min-w-32 rounded-xl border border-border bg-muted/50 px-6 py-1 text-xs font-medium text-foreground transition hover:bg-accent" onClick={() => setDescriptionExpanded(value => !value)}>{descriptionExpanded ? "Show less" : "Show more"}</button> : null}
          </>}
      </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-lg font-semibold text-foreground">Investigation <span className="rounded-full border border-border bg-background px-2 text-xs font-normal text-muted-foreground">{props.comments.length}</span></div>
                <div className="text-xs text-muted-foreground">Notes, decisions and case context</div>
              </div>
              {!noteEditorOpen && props.canUpdateCase ? <NewGenButton onClick={() => setNoteEditorOpen(true)} disabled={props.busy} iconOnly={false} label="Add note" title="Add note" /> : null}
            </div>

            {noteEditorOpen ? <div className="space-y-3">
            <MarkdownEditor
              alwaysShowToolbar
              value={props.commentText}
              onChange={(v) => props.setCommentText(v)}
              disabled={props.busy || !props.canUpdateCase}
              placeholder="Write a note..."
              className="text-sm text-foreground"
            />

            <div className="flex justify-end gap-2">
            <CancelButton onClick={() => { setNoteEditorOpen(false); props.setCommentText(""); }} disabled={props.busy} title="Cancel note" />
            <NewGenButton
              onClick={publishNote}
              disabled={props.busy || !props.canUpdateCase || isRichTextEmpty(props.commentText)}
              iconOnly={false}
              label="Publish"
              title="Publish note"
            />
            </div>
            </div> : null}

            <div className="mt-5 space-y-3">
              {props.comments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-3 text-center">
                  <div className="text-sm font-medium text-foreground">No note yet</div>
                  <div className="mt-1 text-xs text-muted-foreground">Add the first investigation note for this case.</div>
                </div>
              ) : (
                props.comments
                  .slice()
                  .reverse()
                  .map((c, index) => (
                    <div key={c.id} className="relative grid min-w-0 grid-cols-[12px_28px_minmax(0,1fr)] gap-2 sm:gap-3">
                      <div aria-hidden="true" className="relative flex justify-center">
                        {index < props.comments.length - 1 ? <span className="absolute -bottom-3 top-6 border-l border-border" /> : null}
                        <span className="relative mt-5 h-3 w-3 rounded-full border border-muted-foreground bg-card" />
                      </div>
                      <div className="mt-3"><UserAvatar showInitial name={c.author_display} src={c.author_avatar_url} /></div>
                      <div className="min-w-0 rounded-2xl border border-border bg-background p-3 shadow-sm">
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="break-words text-sm font-semibold text-foreground">{c.author_display || "Unknown author"}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(c.created_at)}</span>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          {props.editingCommentId === c.id ? (
                            <>
                              <SaveButton
                                onClick={() => props.saveEditComment(c.id)}
                                disabled={props.busy || !props.canUpdateCase || props.commentBusyId === c.id || isRichTextEmpty(props.editingText)}
                                title="Save comment"
                              >
                                {props.commentBusyId === c.id ? "Saving…" : "Save"}
                              </SaveButton>
                              <CancelButton
                                onClick={props.cancelEditComment}
                                disabled={props.busy || !props.canUpdateCase || props.commentBusyId === c.id}
                                title="Cancel"
                              />
                            </>
                          ) : (
                            <EditGenButton onClick={() => { setLinkAction(null); props.startEditComment(c); }} disabled={props.busy || !props.canUpdateCase} title="Edit comment" />
                          )}

                          <DeleteButton
                            onClick={() => props.removeComment(c.id)}
                            disabled={props.busy || !props.canUpdateCase || props.commentBusyId === c.id}
                            title="Delete comment"
                          />
                        </div>
                      </div>

                      {props.editingCommentId === c.id ? (
                        <div className="mt-3">
                          <MarkdownEditor
                            alwaysShowToolbar
                            value={props.editingText}
                            initialLinkAction={linkAction?.target === c.id ? linkAction.request : undefined}
                            onChange={(v) => props.setEditingText(v)}
                            disabled={props.busy || !props.canUpdateCase || props.commentBusyId === c.id}
                            placeholder="Edit note..."
                            className="text-sm"
                          />
                        </div>
                      ) : (
                        <div className="mt-3 min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_*]:break-words [&_*]:[overflow-wrap:anywhere] [&_a]:break-all [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_code]:whitespace-pre-wrap [&_code]:break-words [&_code]:[overflow-wrap:anywhere]">
                          <MarkdownRenderedContent
                            requireLinkModifier
                            markdown={String((c as any).text || "")}
                            onEditLink={props.canUpdateCase && !props.busy && props.commentBusyId !== c.id ? request => {
                              props.startEditComment(c);
                              setLinkAction({ target: c.id, request });
                            } : undefined}
                            className="min-w-0 max-w-full !rounded-none !border-0 !bg-transparent !shadow-none [&_[contenteditable=false]]:!p-0"
                          />
                        </div>
                      )}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-foreground">Workbook</div>
                <div className="text-xs text-muted-foreground">Checklist and investigation steps</div>
              </div>
              <div className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {props.wbLoading
                  ? "Loading…"
                  : props.workbook?.items?.length
                    ? `${props.workbook.items.filter((x) => x.is_done).length}/${props.workbook.items.length}`
                    : "—"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                className="h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                value={String((props.workbook as any)?.template_id ?? (props.workbook as any)?.template ?? "")}
                disabled={props.busy || !props.canUpdateCase || props.wbBusyApply}
                onChange={async (e) => {
                  const next = e.target.value || null;
                  await props.onApplyWorkbookTemplate(next);
                }}
              >
                <option value="">No template</option>
                {props.wbTemplates
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
              {props.wbBusyApply ? <span className="text-xs text-muted-foreground">Saving…</span> : null}
            </div>

            <div className="mt-3 space-y-2">
              {!props.workbook ? (
                <div className="text-sm text-muted-foreground">No workbook applied.</div>
              ) : props.workbook.items.length === 0 ? (
                <div className="text-sm text-muted-foreground">Empty workbook.</div>
              ) : (
                props.workbook.items
                  .slice()
                  .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
                  .map((it) => (
                    <label key={it.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-background/60 p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <input
                          type="checkbox"
                          checked={!!it.is_done}
                          disabled={props.busy || !props.canUpdateCase || props.wbBusyItemId === it.id}
                          onChange={(e) => {
                            void props.onToggleWorkbookItem(it.id, e.target.checked);
                          }}
                        />
                        <span className={`text-sm break-words ${it.is_done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                          {it.label}
                        </span>
                      </div>
                      {props.wbBusyItemId === it.id ? <span className="text-xs text-muted-foreground">Saving…</span> : null}
                    </label>
                  ))
              )}
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-foreground">Linked alerts</div>
                <div className="text-xs text-muted-foreground">Alerts currently merged into this case</div>
              </div>
              <div className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {props.linkedAlerts.length}
              </div>
            </div>

            {props.linkedAlerts.length === 0 ? (
              <div className="text-sm text-muted-foreground">No linked alert.</div>
            ) : (
              <div className="space-y-2">
                {props.linkedAlerts
                  .slice()
                  .reverse()
                  .map((al) => (
                    <div key={al.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-background/60 p-3">
                      <div className="min-w-0">
                        <Link to={`/alerts/${al.id}`} className="block truncate text-sm font-medium text-foreground hover:underline" title={al.title}>
                          {al.title || al.id}
                        </Link>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {al.status ? `${al.status} • ` : ""}
                          {formatDate(al.created_at)}
                        </div>
                      </div>

                      {props.canUnmerge ? (
                        <UnMergeButton
                          onClick={() => props.setConfirmUnmerge({ id: al.id, title: al.title })}
                          disabled={props.busy}
                          title="Unmerge alert"
                        />
                      ) : null}
                    </div>
                  ))}
              </div>
            )}
          </Card>


          {props.canViewTasks ? (
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-foreground">Linked tasks</div>
                  <div className="text-xs text-muted-foreground">Tasks currently linked to this case</div>
                </div>
                <div className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {props.linkedTasks.length}
                </div>
              </div>

              {props.linkedTasks.length === 0 ? (
                <div className="text-sm text-muted-foreground">No linked task.</div>
              ) : (
                <div className="space-y-2">
                  {props.linkedTasks
                    .slice()
                    .sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")))
                    .map((task) => (
                      <div key={task.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-background/60 p-3">
                        <div className="min-w-0">
                          <Link to={`/tasks/${task.id}`} className="block truncate text-sm font-medium text-foreground hover:underline" title={task.title}>
                            {task.title || task.id}
                          </Link>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {task.status ? `${task.status} • ` : ""}
                            {task.priority ? `${task.priority} • ` : ""}
                            {task.due_date ? `Due ${formatDate(task.due_date)}` : `Updated ${formatDate(task.updated_at || task.created_at)}`}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </Card>
          ) : null}


          <Card className="p-4">
            <div className="mb-3">
              <div className="text-lg font-semibold text-foreground">Attachments</div>
              <div className="text-xs text-muted-foreground">Files attached to this investigation</div>
            </div>

            <label className="block cursor-pointer rounded-2xl border border-dashed border-border bg-background/50 p-3 text-center text-sm text-muted-foreground transition hover:bg-accent/40">
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) props.onUploadFile(f);
                  e.currentTarget.value = "";
                }}
                disabled={props.busy || !props.canUpdateCase}
              />
              Click to upload
            </label>

            <div className="mt-3 space-y-2">
              {props.attachments.length === 0 ? (
                <div className="text-sm text-muted-foreground">No attachment.</div>
              ) : (
                props.attachments
                  .slice()
                  .reverse()
                  .map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-background/60 p-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{a.original_name || "file"}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{formatDate(a.created_at)}</div>
                      </div>

                      <div className="flex items-center gap-2">
                        {(a as any).file_url ? (
                          <OpenGenButton
                            iconOnly
                            title="Open attachment"
                            disabled={props.busy}
                            onClick={() => {
                              window.open(resolveMediaUrl((a as any).file_url), "_blank", "noopener,noreferrer");
                            }}
                          />
                        ) : null}
                        <DeleteButton onClick={() => props.removeAttachment(a.id)} disabled={props.busy || !props.canUpdateCase} title="Delete attachment" />
                      </div>
                    </div>
                  ))
              )}
            </div>
          </Card>
        </div>
    </div>
  );
}
