import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import Card from "../../ui/Card";
import MarkdownEditor from "../../ui/MarkdownEditor";
import MarkdownRenderedContent from "../../ui/MarkdownRenderedContent";
import { CancelButton, DeleteButton, EditGenButton, NewGenButton, OpenGenButton, SaveButton, UnMergeButton } from "../../ui/IconButton";
import type { Attachment, Comment, LinkedAlert, LinkedTask, WorkbookInstance } from "../../../api/caseDetail";
import type { WorkbookTemplate } from "../../../api/settingsWorkbooks";
import { formatDate, isRichTextEmpty } from "./utils";



type Props = {
  busy: boolean;
  canUpdateCase: boolean;
  editDescription: string;
  description: string;
  setEditDescription: React.Dispatch<React.SetStateAction<string>>;
  saveIfDirty: (description?: string) => void | Promise<void>;
  onDescriptionFocusChange?: (focused: boolean) => void;
  commentText: string;
  setCommentText: React.Dispatch<React.SetStateAction<string>>;
  submitComment: () => void | Promise<void>;
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
  const caseDescFocusedRef = useRef(false);

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
    await props.saveIfDirty(props.editDescription ?? "");
    setDescriptionEditing(false);
  }

  function cancelDescriptionEdit() {
    props.setEditDescription(props.description ?? "");
    setDescriptionEditing(false);
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div
          onFocus={() => setDescriptionEditing(true)}
          onBlur={(e) => {
            const wrapper = e.currentTarget;

            window.requestAnimationFrame(() => {
              const activeElement = document.activeElement;

              if (activeElement && wrapper.contains(activeElement)) {
                return;
              }

              const openMdxDropdown = document.querySelector(
                "[role='listbox'], [role='menu'], [data-radix-popper-content-wrapper]"
              );

              if (openMdxDropdown) {
                return;
              }

              setDescriptionEditing(false);
            });
          }}
        >
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
            ) : null}
          </div>

          <MarkdownEditor
            value={props.editDescription ?? ""}
            onChange={(v) => props.setEditDescription(v)}
            disabled={props.busy || !props.canUpdateCase}
            placeholder="Write a description..."
            className="text-sm"
          />
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)]">
        <div className="min-w-0">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-foreground">Investigation</div>
                <div className="text-xs text-muted-foreground">Notes, decisions and analyst context</div>
              </div>
            </div>

            <MarkdownEditor
              value={props.commentText}
              onChange={(v) => props.setCommentText(v)}
              disabled={props.busy || !props.canUpdateCase}
              placeholder="Write a note..."
              className="text-sm text-foreground"
            />

            <NewGenButton
              onClick={props.submitComment}
              disabled={props.busy || !props.canUpdateCase || isRichTextEmpty(props.commentText)}
              className="mt-3 w-full"
              iconOnly={false}
              label="Add note"
              title="Add note"
            />

            <div className="mt-5 space-y-3">
              {props.comments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-8 text-center">
                  <div className="text-sm font-medium text-foreground">No note yet</div>
                  <div className="mt-1 text-xs text-muted-foreground">Add the first investigation note for this case.</div>
                </div>
              ) : (
                props.comments
                  .slice()
                  .reverse()
                  .map((c) => (
                    <div key={c.id} className="min-w-0 overflow-hidden rounded-2xl border border-border bg-background p-4 shadow-sm">
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="min-w-0 break-words text-xs text-muted-foreground">
                          {formatDate(c.created_at)}
                          {c.author_display ? <span className="ml-1 text-muted-foreground/90">• {c.author_display}</span> : null}
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
                            <EditGenButton onClick={() => props.startEditComment(c)} disabled={props.busy || !props.canUpdateCase} title="Edit comment" />
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
                            value={props.editingText}
                            onChange={(v) => props.setEditingText(v)}
                            disabled={props.busy || !props.canUpdateCase || props.commentBusyId === c.id}
                            placeholder="Edit note..."
                            className="text-sm"
                          />
                        </div>
                      ) : (
                        <div className="mt-3 min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_*]:break-words [&_*]:[overflow-wrap:anywhere] [&_a]:break-all [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_code]:whitespace-pre-wrap [&_code]:break-words [&_code]:[overflow-wrap:anywhere]">
                          <MarkdownRenderedContent
                            markdown={String((c as any).text || "")}
                            className="min-w-0 max-w-full"
                          />
                        </div>
                      )}
                    </div>
                  ))
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
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

            <div className="mt-4 space-y-2">
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

          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
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
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
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


          <Card className="p-5">
            <div className="mb-4">
              <div className="text-lg font-semibold text-foreground">Attachments</div>
              <div className="text-xs text-muted-foreground">Files attached to this investigation</div>
            </div>

            <label className="block cursor-pointer rounded-2xl border border-dashed border-border bg-background/50 p-5 text-center text-sm text-muted-foreground transition hover:bg-accent/40">
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

            <div className="mt-4 space-y-2">
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
                              window.open((a as any).file_url, "_blank", "noopener,noreferrer");
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
    </div>
  );
}
