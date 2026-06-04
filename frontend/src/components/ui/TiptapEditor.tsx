import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import {
  EditorContent,
  useEditor,
} from "@tiptap/react";
import type { Level } from "@tiptap/extension-heading";

import { buildTiptapExtensions } from "../../api/tiptapExtensions";

import { HighlightButton, CodeButton } from "../../components/ui/IconButton";



type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};


export type TiptapEditorHandle = {
  getHTML: () => string;
};


const PRESET_TEXT_COLORS = [
  { value: "" },
  { value: "#0f172a" },
  { value: "#ef4444" },
  { value: "#f97316" },
  { value: "#eab308" },
  { value: "#16a34a" },
  { value: "#06b6d4" },
  { value: "#2563eb" },
  { value: "#7c3aed" },
  { value: "#ec4899" },
  { value: "#475569" },
];


function getHeadingValue(editor: NonNullable<ReturnType<typeof useEditor>>) {
  const levels: Level[] = [1, 2, 3, 4, 5, 6];
  const activeLevel = levels.find((level) =>
    editor.isActive("heading", { level })
  );

  return activeLevel ? String(activeLevel) : "0";
}

const TiptapEditor = forwardRef<TiptapEditorHandle, Props>(function TiptapEditor(props, ref) {
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const flushHtml = (editorInstance: NonNullable<ReturnType<typeof useEditor>>) => {
    props.onChange(editorInstance.getHTML());
  };
  const editor = useEditor({
    editable: !props.disabled,
    immediatelyRender: false,
    extensions: buildTiptapExtensions({
      placeholder: props.placeholder ?? "",
      securePaste: true,
    }),
    content: props.value || "",
    onUpdate({ editor }) {
      props.onChange(editor.getHTML());
    },
    onTransaction({ editor }) {
      props.onChange(editor.getHTML());
    },
    onFocus() {
      setIsEditorFocused(true);
    },
    onBlur({ editor, event }) {
      flushHtml(editor);

      const nextTarget = event.relatedTarget as Node | null;

      const root = (editor?.options.element as HTMLElement | null)?.closest(
        "[data-tiptap-wrapper]"
      ) as HTMLElement | null;

      if (root && nextTarget && root.contains(nextTarget)) {
        return;
      }

      setIsEditorFocused(false);
      setColorMenuOpen(false);
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      getHTML: () => editor?.getHTML() ?? props.value ?? "",
    }),
    [editor, props.value],
  );

  useEffect(() => {
    if (!editor) return;

    const currentHtml = editor.getHTML();
    const nextHtml = props.value || "";

    if (nextHtml !== currentHtml) {
      editor.commands.setContent(nextHtml, { emitUpdate: false });
    }

    editor.setEditable(!props.disabled);
  }, [editor, props.value, props.disabled]);

  useEffect(() => {
    if (props.disabled) {
      setColorMenuOpen(false);
      setIsEditorFocused(false);
    }
  }, [props.disabled]);

  if (!editor) {
    return null;
  }

  const btn = (active: boolean) =>
    [
      "inline-flex h-8 min-w-8 border-none items-center justify-center rounded-xl px-2 text-[11px] font-semibold transition-all duration-200",
      "focus:outline-none focus:ring-2 focus:ring-blue-500/20",
      props.disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer active:scale-95",
      
      active
        ?
          "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900"
        :
          "bg-slate-200/40 text-slate-500 hover:bg-slate-200/80 hover:text-slate-900 dark:bg-slate-800/40 dark:text-slate-400 dark:hover:bg-slate-800/80 dark:hover:text-slate-100",
    ].join(" ");

  const getActiveTextColor = () => {
    const active = PRESET_TEXT_COLORS.find(
      (item) => item.value && editor.isActive("textStyle", { color: item.value })
    );
    return active?.value ?? "";
  };

  const showToolbar = isEditorFocused || colorMenuOpen;

  return (
    <div
      data-tiptap-wrapper
      className="overflow-hidden rounded-2xl border-none"
    >
      {showToolbar ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
          <select
            className="h-8 rounded-xl bg-background px-2 text-xs text-foreground outline-none transition hover:bg-accent focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60"
            value={getHeadingValue(editor)}
            onChange={(e) => {
              const raw = e.target.value;

              if (raw === "0") {
                editor.chain().focus().setParagraph().run();
                return;
              }

              editor
                .chain()
                .focus()
                .toggleHeading({ level: Number(raw) as Level })
                .run();
            }}
            disabled={props.disabled}
          >
            <option value="0">Paragraph</option>
            <option value="1">H1</option>
            <option value="2">H2</option>
            <option value="3">H3</option>
            <option value="4">H4</option>
            <option value="5">H5</option>
            <option value="6">H6</option>
          </select>

          <div className="h-6 w-px bg-border" />

          <button
            type="button"
            className={btn(editor.isActive("bold"))}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleBold().run()}
            disabled={props.disabled}
            title="Bold"
          >
            <b>B</b>
          </button>

          <button
            type="button"
            className={btn(editor.isActive("italic"))}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            disabled={props.disabled}
            title="Italic"
          >
            <i>I</i>
          </button>

          <button
            type="button"
            className={btn(editor.isActive("underline"))}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            disabled={props.disabled}
            title="Underline"
          >
            <u>U</u>
          </button>

          <button
            type="button"
            className={btn(editor.isActive("strike"))}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            disabled={props.disabled}
            title="Strike"
          >
            <s>S</s>
          </button>

          <HighlightButton
            type="button"
            className={btn(editor.isActive("highlight"))}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
            disabled={props.disabled}
            title="Highlight"
          />

          <button
            type="button"
            className={btn(editor.isActive("blockquote"))}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            disabled={props.disabled}
            title="Blockquote"
          >
            ❝
          </button>

          <CodeButton
            type="button"
            className={btn(editor.isActive("codeBlock"))}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            disabled={props.disabled}
            title="Code block"
          />

          <div className="h-6 w-px bg-border" />

          <div className="relative flex items-center">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setColorMenuOpen((v) => !v)}
              disabled={props.disabled}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              title="Text color"
            >
              <span
                className="h-4 w-4 rounded-full border border-border"
                style={{ backgroundColor: getActiveTextColor() || "#000000" }}
              />
            </button>

            {colorMenuOpen ? (
              <div
                className="absolute left-0 top-10 z-[100] grid min-w-[160px] grid-cols-5 gap-3 rounded-2xl border border-border bg-popover p-3 shadow-panel"
                style={{
                  transform: "translateZ(0)",
                  backfaceVisibility: "hidden",
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => e.stopPropagation()}
              >
                {PRESET_TEXT_COLORS.map((item, i) => (
                  <button
                    key={i}
                    type="button"
                    className="h-6 w-6 shrink-0 rounded-full border border-border transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ring/20"
                    style={{ backgroundColor: item.value || "#ffffff" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!item.value) {
                        editor.chain().focus().unsetColor().run();
                      } else {
                        editor.chain().focus().setColor(item.value).run();
                      }
                      setColorMenuOpen(false);
                    }}
                    disabled={props.disabled}
                    title={item.value || "Default"}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={[
          "tiptap-editor min-h-[140px] px-4 py-3 text-sm text-foreground",
          "focus-within:ring-2 focus-within:ring-ring/20",
          props.className || "",
        ].join(" ")}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});

export default TiptapEditor;