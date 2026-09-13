import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
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
  { value: "" }, { value: "#0f172a" }, { value: "#ef4444" },
  { value: "#f97316" }, { value: "#eab308" }, { value: "#16a34a" },
  { value: "#06b6d4" }, { value: "#2563eb" }, { value: "#7c3aed" },
  { value: "#ec4899" }, { value: "#475569" },
];

export function insertExchangeHtml(value: string, start: number, end: number, opening: string, closing = "") {
  return {
    value: value.slice(0, start) + opening + value.slice(start, end) + closing + value.slice(end),
    start: start + opening.length,
    end: end + opening.length,
  };
}

const TiptapEditor = forwardRef<TiptapEditorHandle, Props>(function TiptapEditor(props, ref) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [isEditorFocused, setIsEditorFocused] = useState(false);

  useImperativeHandle(ref, () => ({ getHTML: () => props.value ?? "" }), [props.value]);

  useLayoutEffect(() => {
    const input = textarea.current;
    if (!input) return;
    input.style.height = "120px";
    input.style.height = Math.max(120, input.scrollHeight) + "px";
    if (selection.current) {
      input.setSelectionRange(selection.current.start, selection.current.end);
      selection.current = null;
    }
  }, [props.value]);

  useEffect(() => {
    if (props.disabled) {
      setColorMenuOpen(false);
      setIsEditorFocused(false);
    }
  }, [props.disabled]);

  function insert(opening: string, closing = "") {
    const input = textarea.current;
    if (!input || props.disabled) return;
    const next = insertExchangeHtml(input.value, input.selectionStart, input.selectionEnd, opening, closing);
    const replacement = opening + input.value.slice(input.selectionStart, input.selectionEnd) + closing;
    input.focus();
    if (document.execCommand("insertText", false, replacement)) {
      props.onChange(input.value);
      input.setSelectionRange(next.start, next.end);
      return;
    }
    selection.current = next;
    props.onChange(next.value);
  }

  const btn = [
    "inline-flex h-8 min-w-8 border-none items-center justify-center rounded-xl px-2 text-[11px] font-semibold transition-all duration-200",
    "focus:outline-none focus:ring-2 focus:ring-blue-500/20",
    props.disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer active:scale-95",
    "bg-slate-200/40 text-slate-500 hover:bg-slate-200/80 hover:text-slate-900 dark:bg-slate-800/40 dark:text-slate-400 dark:hover:bg-slate-800/80 dark:hover:text-slate-100",
  ].join(" ");

  return (
    <div
      data-tiptap-wrapper
      className="overflow-hidden rounded-2xl border-none"
      onBlur={(event) => {
        if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Node)) return;
        setIsEditorFocused(false);
        setColorMenuOpen(false);
      }}
    >
      {isEditorFocused || colorMenuOpen ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
          <select
            aria-label="Heading"
            className="h-8 rounded-xl bg-background px-2 text-xs text-foreground outline-none transition hover:bg-accent focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60"
            value=""
            onChange={(e) => {
              const tag = e.target.value === "0" ? "p" : "h" + e.target.value;
              insert("<" + tag + ">", "</" + tag + ">");
            }}
            disabled={props.disabled}
          >
            <option value="" disabled hidden>Paragraph</option>
            <option value="0">Paragraph</option>
            <option value="1">H1</option>
            <option value="2">H2</option>
            <option value="3">H3</option>
            <option value="4">H4</option>
            <option value="5">H5</option>
            <option value="6">H6</option>
          </select>
          <div className="h-6 w-px bg-border" />
          <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => insert("<strong>", "</strong>")} disabled={props.disabled} title="Bold"><b>B</b></button>
          <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => insert("<em>", "</em>")} disabled={props.disabled} title="Italic"><i>I</i></button>
          <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => insert("<u>", "</u>")} disabled={props.disabled} title="Underline"><u>U</u></button>
          <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => insert("<s>", "</s>")} disabled={props.disabled} title="Strike"><s>S</s></button>
          <HighlightButton type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => insert("<mark>", "</mark>")} disabled={props.disabled} title="Highlight" />
          <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => insert("<blockquote>", "</blockquote>")} disabled={props.disabled} title="Blockquote">❝</button>
          <CodeButton type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => insert("<pre><code>", "</code></pre>")} disabled={props.disabled} title="Code block" />
          <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => insert("<br>")} disabled={props.disabled} title="Line break">↵</button>
          <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => insert("<hr>")} disabled={props.disabled} title="Horizontal rule">―</button>
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
              <span className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: "#000000" }} />
            </button>
            {colorMenuOpen ? (
              <div
                className="absolute left-0 top-10 z-[100] grid min-w-[160px] grid-cols-5 gap-3 rounded-2xl border border-border bg-popover p-3 shadow-panel"
                style={{ transform: "translateZ(0)", backfaceVisibility: "hidden" }}
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
                      insert('<span style="color: ' + (item.value || "inherit") + '">', "</span>");
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
      <div className={["tiptap-editor min-h-[140px] px-4 py-3 text-sm text-foreground", props.className || ""].join(" ")}>
        <textarea
          ref={textarea}
          aria-label="Message body"
          className="block min-h-[120px] w-full resize-none border-none bg-transparent p-0 font-[inherit] text-[inherit] leading-[inherit] text-foreground outline-none placeholder:text-muted-foreground"
          style={{ outline: "none" }}
          value={props.value || ""}
          onChange={(e) => props.onChange(e.target.value)}
          onFocus={() => setIsEditorFocused(true)}
          onKeyDown={(event) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
            if (event.key.toLowerCase() === "b") {
              event.preventDefault();
              insert("<strong>", "</strong>");
            } else if (event.key.toLowerCase() === "i") {
              event.preventDefault();
              insert("<em>", "</em>");
            }
          }}
          placeholder={props.placeholder}
          disabled={props.disabled}
          spellCheck={false}
        />
      </div>
    </div>
  );
});

export default TiptapEditor;
