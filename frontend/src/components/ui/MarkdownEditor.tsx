import { useEffect, useMemo, useRef, useState } from "react";
import {
  MDXEditor,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  CodeToggle,
  CreateLink,
  InsertCodeBlock,
  InsertTable,
  ListsToggle,
  Separator,
  StrikeThroughSupSubToggles,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  headingsPlugin,
  linkPlugin,
  linkDialogPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  toolbarPlugin,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onEditorBlur?: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

function escapeHtmlTags(value: string) {
  return String(value || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripSupportedHtmlTags(value: string) {
  return String(value || "").replace(/<\/?(h[1-6]|p|blockquote|strong|b|em|i|u|s|strike|del|sup|sub|ul|ol|li|br|hr)\b[^>]*>/gi, "");
}

function normalizeSupportedHtmlToMarkdown(value: string) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n\n---\n\n")
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, content) => {
      const depth = Math.min(6, Math.max(1, Number(level) || 3));
      const text = stripSupportedHtmlTags(content).trim();
      return text ? `\n${"#".repeat(depth)} ${text}\n` : "";
    })
    .replace(/<p\b[^>]*>\s*<\/p>/gi, "\n")
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_match, content) => {
      const text = String(content || "").trim();
      return text ? `\n${text}\n` : "";
    })
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, content) => {
      const text = String(content || "").trim();
      if (!text) return "";
      return `\n${text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n`;
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, content) => {
      const text = String(content || "").trim();
      return text ? `**${text}**` : "";
    })
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, content) => {
      const text = String(content || "").trim();
      return text ? `*${text}*` : "";
    })
    .replace(/<(s|strike|del)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, content) => {
      const text = String(content || "").trim();
      return text ? `~~${text}~~` : "";
    })
    .replace(/<u\b[^>]*>([\s\S]*?)<\/u>/gi, (_match, content) => {
      const text = String(content || "").trim();
      return text ? `<u>${escapeHtmlTags(text)}</u>` : "";
    })
    .replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, (_match, content) => {
      const text = String(content || "").trim();
      return text ? `<sup>${escapeHtmlTags(text)}</sup>` : "";
    })
    .replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, (_match, content) => {
      const text = String(content || "").trim();
      return text ? `<sub>${escapeHtmlTags(text)}</sub>` : "";
    })
    .replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_match, content) => {
      return `\n${String(content || "")
        .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_liMatch, liContent) => {
          const text = stripSupportedHtmlTags(liContent).trim();
          return text ? `- ${text}\n` : "";
        })
        .trim()}\n`;
    })
    .replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_match, content) => {
      let index = 0;
      return `\n${String(content || "")
        .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_liMatch, liContent) => {
          const text = stripSupportedHtmlTags(liContent).trim();
          if (!text) return "";
          index += 1;
          return `${index}. ${text}\n`;
        })
        .trim()}\n`;
    });
}

function escapeUnsupportedHtmlInline(value: string) {
  return String(value || "")
    .split(/(`+[^`]*`+)/g)
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`")) {
        return part;
      }

      const normalized = normalizeSupportedHtmlToMarkdown(part);

      return normalized
        .replace(/<!--[\s\S]*?-->/g, escapeHtmlTags)
        .replace(/<![A-Za-z][^>]*>/g, escapeHtmlTags)
        .replace(/<\/?(?!u\b|sup\b|sub\b)[A-Za-z][A-Za-z0-9:-]*(?:\s[^<>]*)?>/g, escapeHtmlTags);
    })
    .join("");
}

function markdownForMdxEditor(value: string) {
  const lines = String(value || "").split("\n");
  let inFence = false;
  let fenceMarker = "";

  return lines
    .map((line) => {
      const trimmed = line.trimStart();

      if (!inFence && (trimmed.startsWith("```") || trimmed.startsWith("~~~"))) {
        inFence = true;
        fenceMarker = trimmed.startsWith("```") ? "```" : "~~~";
        return line;
      }

      if (inFence) {
        if (trimmed.startsWith(fenceMarker)) {
          inFence = false;
          fenceMarker = "";
        }

        return line;
      }

      return escapeUnsupportedHtmlInline(line);
    })
    .join("\n");
}

export default function MarkdownEditor(props: Props) {
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastValueRef = useRef(props.value || "");
  const focusedRef = useRef(false);
  const skipNextBlurRef = useRef(false);
  const [toolbarVisible, setToolbarVisible] = useState(false);


  const plugins = useMemo(
    () => [
      headingsPlugin(),
      listsPlugin(),
      linkDialogPlugin(),
      quotePlugin(),
      linkPlugin(),
      tablePlugin(),
      markdownShortcutPlugin(),
      codeBlockPlugin({
        defaultCodeBlockLanguage: "plaintext",
      }),
      codeMirrorPlugin({
        codeBlockLanguages: {
          plaintext: "Plain text",
          bash: "Bash",
          powershell: "PowerShell",
          json: "JSON",
          yaml: "YAML",
          sql: "SQL",
          javascript: "JavaScript",
          typescript: "TypeScript",
          python: "Python",
          html: "HTML",
          xml: "XML",
          ini: "INI",
        },
      }),
      toolbarPlugin({
        toolbarContents: () => (
          <>
            <UndoRedo />
            <Separator />
            <BlockTypeSelect />
            <Separator />
            <BoldItalicUnderlineToggles />
            <StrikeThroughSupSubToggles />
            <CodeToggle />
            <Separator />
            <ListsToggle />
            <Separator />
            <CreateLink />
            <InsertTable />
            <InsertCodeBlock />
          </>
        ),
      }),
    ],
    [],
  );

  useEffect(() => {
    const nextValue = props.value || "";
    const root = rootRef.current;
    const activeElement = document.activeElement;

    if (focusedRef.current) return;

    if (root && activeElement && root.contains(activeElement)) return;

    if (nextValue !== lastValueRef.current) {
      lastValueRef.current = nextValue;
      editorRef.current?.setMarkdown(markdownForMdxEditor(nextValue));
    }
  }, [props.value]);



  return (
    <div
      ref={rootRef}
      data-markdown-editor-root
      data-toolbar-visible={toolbarVisible ? "true" : "false"}
      className={[
        "markdown-editor overflow-hidden rounded-2xl border border-border bg-card text-sm text-foreground shadow-sm transition",
        props.disabled ? "opacity-60" : "",
        props.className || "",
      ].join(" ")}
      onPointerDownCapture={(event) => {
        const target = event.target as HTMLElement | null;

        if (
          target?.closest(".mdxeditor-toolbar") ||
          target?.closest("[data-radix-trigger]") ||
          target?.closest("[class*='_selectTrigger']")
        ) {
          skipNextBlurRef.current = true;
        }
      }}
      onFocusCapture={() => {
        focusedRef.current = true;
        setToolbarVisible(true);
      }}
      onBlurCapture={() => {
        window.requestAnimationFrame(() => {
          const root = rootRef.current;
          const activeElement = document.activeElement;

          if (root && activeElement && root.contains(activeElement)) {
            focusedRef.current = true;
            setToolbarVisible(true);
            return;
          }

          if (
            document.querySelector("[data-radix-popper-content-wrapper]") ||
            document.querySelector("[role='listbox']") ||
            document.querySelector("[role='menu']")
          ) {
            skipNextBlurRef.current = true;
            focusedRef.current = true;
            setToolbarVisible(true);
            return;
          }

          if (skipNextBlurRef.current) {
            skipNextBlurRef.current = false;
            focusedRef.current = true;
            setToolbarVisible(true);
            return;
          }

          focusedRef.current = false;
          setToolbarVisible(false);
          props.onEditorBlur?.(lastValueRef.current);
        });
      }}
      onMouseEnter={() => {
        setToolbarVisible(true);
      }}
      onMouseLeave={() => {
        const root = rootRef.current;
        const activeElement = document.activeElement;

        if (root && activeElement && root.contains(activeElement)) {
          setToolbarVisible(true);
          return;
        }

        setToolbarVisible(false);
      }}
    >
    <style>
      {`
        .markdown-editor .mdxeditor,
        .markdown-rendered-content .mdxeditor {
          background: transparent;
          color: hsl(var(--foreground));
        }

        .markdown-editor ul,
        .markdown-rendered-content ul {
          list-style-type: disc;
          padding-left: 1.5rem;
          margin-top: 0.5rem;
          margin-bottom: 0.5rem;
        }

        .markdown-editor ol,
        .markdown-rendered-content ol {
          list-style-type: decimal;
          padding-left: 1.5rem;
          margin-top: 0.5rem;
          margin-bottom: 0.5rem;
        }

        .markdown-editor li,
        .markdown-rendered-content li {
          display: list-item;
          margin-top: 0.25rem;
          margin-bottom: 0.25rem;
        }

        .markdown-editor li > p,
        .markdown-rendered-content li > p {
          margin: 0;
        }

        .markdown-editor ul ul,
        .markdown-rendered-content ul ul {
          list-style-type: circle;
        }

        .markdown-editor ul ul ul,
        .markdown-rendered-content ul ul ul {
          list-style-type: square;
        }

        .markdown-editor ol ol,
        .markdown-rendered-content ol ol {
          list-style-type: lower-alpha;
        }

        .markdown-editor ol ol ol,
        .markdown-rendered-content ol ol ol {
          list-style-type: lower-roman;
        }

        .markdown-editor h1,
        .markdown-rendered-content h1 {
          display: block;
          font-size: 1.875rem;
          line-height: 2.25rem;
          font-weight: 700;
          margin-top: 1rem;
          margin-bottom: 0.75rem;
          color: hsl(var(--foreground));
        }

        .markdown-editor h2,
        .markdown-rendered-content h2 {
          display: block;
          font-size: 1.5rem;
          line-height: 2rem;
          font-weight: 700;
          margin-top: 0.875rem;
          margin-bottom: 0.625rem;
          color: hsl(var(--foreground));
        }

        .markdown-editor h3,
        .markdown-rendered-content h3 {
          display: block;
          font-size: 1.25rem;
          line-height: 1.75rem;
          font-weight: 650;
          margin-top: 0.75rem;
          margin-bottom: 0.5rem;
          color: hsl(var(--foreground));
        }

        .markdown-editor h4,
        .markdown-rendered-content h4,
        .markdown-editor h5,
        .markdown-rendered-content h5,
        .markdown-editor h6,
        .markdown-rendered-content h6 {
          display: block;
          font-size: 1rem;
          line-height: 1.5rem;
          font-weight: 650;
          margin-top: 0.625rem;
          margin-bottom: 0.375rem;
          color: hsl(var(--foreground));
        }

        .markdown-editor h1:first-child,
        .markdown-editor h2:first-child,
        .markdown-editor h3:first-child,
        .markdown-rendered-content h1:first-child,
        .markdown-rendered-content h2:first-child,
        .markdown-rendered-content h3:first-child {
          margin-top: 0;
        }

        .markdown-editor a,
        .markdown-rendered-content a {
          color: hsl(var(--primary)) !important;
          text-decoration-line: underline;
          text-decoration-thickness: 1px;
          text-underline-offset: 3px;
          cursor: pointer;
        }

        .markdown-editor a:hover,
        .markdown-rendered-content a:hover {
          color: hsl(var(--primary)) !important;
          text-decoration-thickness: 2px;
        }

        .markdown-editor a code,
        .markdown-rendered-content a code {
          color: hsl(var(--primary)) !important;
        }

        .markdown-editor .mdxeditor-toolbar {
          opacity: 0;
          transition: opacity 120ms ease;
          background: hsl(var(--card));
          border-bottom: 1px solid hsl(var(--border));
          color: hsl(var(--foreground));
        }

        .markdown-editor[data-toolbar-visible="true"] .mdxeditor-toolbar,
        .markdown-editor:hover .mdxeditor-toolbar,
        .markdown-editor:focus-within .mdxeditor-toolbar {
          opacity: 1;
        }

        .markdown-editor .mdxeditor-toolbar button[title="Superscript"],
        .markdown-editor .mdxeditor-toolbar button[aria-label="Superscript"],
        .markdown-editor .mdxeditor-toolbar button[title="Subscript"],
        .markdown-editor .mdxeditor-toolbar button[aria-label="Subscript"] {
          display: none !important;
        }

        .markdown-editor .mdxeditor-toolbar button[title="superscript"],
        .markdown-editor .mdxeditor-toolbar button[aria-label="superscript"],
        .markdown-editor .mdxeditor-toolbar button[title="subscript"],
        .markdown-editor .mdxeditor-toolbar button[aria-label="subscript"] {
          display: none !important;
        }

        .markdown-editor .mdxeditor-toolbar button,
        .markdown-editor .mdxeditor-toolbar [role="button"],
        .markdown-editor .mdxeditor-toolbar select,
        .markdown-editor .mdxeditor-toolbar [data-radix-trigger] {
          color: hsl(var(--foreground));
          background: transparent;
        }

        .markdown-editor .mdxeditor-toolbar button,
        .markdown-editor .mdxeditor-toolbar [role="button"],
        .markdown-editor .mdxeditor-toolbar [data-radix-trigger],
        .markdown-editor .mdxeditor-toolbar [class*="_toolbarToggleItem"],
        .markdown-editor .mdxeditor-toolbar [class*="_toolbarButton"] {
          color: hsl(var(--foreground)) !important;
        }

        .markdown-editor .mdxeditor-toolbar button svg,
        .markdown-editor .mdxeditor-toolbar [role="button"] svg,
        .markdown-editor .mdxeditor-toolbar [data-radix-trigger] svg,
        .markdown-editor .mdxeditor-toolbar [class*="_toolbarToggleItem"] svg,
        .markdown-editor .mdxeditor-toolbar [class*="_toolbarButton"] svg {
          color: hsl(var(--foreground)) !important;
          stroke: hsl(var(--foreground)) !important;
          fill: none !important;
        }

        .markdown-editor .mdxeditor-toolbar button svg *,
        .markdown-editor .mdxeditor-toolbar [role="button"] svg *,
        .markdown-editor .mdxeditor-toolbar [data-radix-trigger] svg *,
        .markdown-editor .mdxeditor-toolbar [class*="_toolbarToggleItem"] svg *,
        .markdown-editor .mdxeditor-toolbar [class*="_toolbarButton"] svg * {
          stroke: hsl(var(--foreground)) !important;
        }

        .markdown-editor .mdxeditor-toolbar button:hover,
        .markdown-editor .mdxeditor-toolbar [role="button"]:hover,
        .markdown-editor .mdxeditor-toolbar [data-radix-trigger]:hover,
        .markdown-editor .mdxeditor-toolbar [class*="_toolbarToggleItem"]:hover,
        .markdown-editor .mdxeditor-toolbar [class*="_toolbarButton"]:hover {
          background: hsl(var(--accent)) !important;
          color: hsl(var(--accent-foreground)) !important;
        }

        .markdown-editor .mdxeditor-toolbar button:hover svg,
        .markdown-editor .mdxeditor-toolbar [role="button"]:hover svg,
        .markdown-editor .mdxeditor-toolbar [data-radix-trigger]:hover svg,
        .markdown-editor .mdxeditor-toolbar [class*="_toolbarToggleItem"]:hover svg,
        .markdown-editor .mdxeditor-toolbar [class*="_toolbarButton"]:hover svg {
          color: hsl(var(--accent-foreground)) !important;
          stroke: hsl(var(--accent-foreground)) !important;
        }

        .markdown-editor .mdxeditor-toolbar button:hover svg *,
        .markdown-editor .mdxeditor-toolbar [role="button"]:hover svg *,
        .markdown-editor .mdxeditor-toolbar [data-radix-trigger]:hover svg *,
        .markdown-editor .mdxeditor-toolbar [class*="_toolbarToggleItem"]:hover svg *,
        .markdown-editor .mdxeditor-toolbar [class*="_toolbarButton"]:hover svg * {
          stroke: hsl(var(--accent-foreground)) !important;
        }

        .markdown-editor .mdxeditor-toolbar button[data-state="on"],
        .markdown-editor .mdxeditor-toolbar [role="button"][data-state="on"],
        .markdown-editor .mdxeditor-toolbar [data-state="on"],
        .markdown-editor .mdxeditor-toolbar [aria-pressed="true"] {
          background: hsl(var(--accent)) !important;
          color: hsl(var(--accent-foreground)) !important;
        }

        .markdown-editor .mdxeditor-toolbar button[data-state="on"] svg,
        .markdown-editor .mdxeditor-toolbar [role="button"][data-state="on"] svg,
        .markdown-editor .mdxeditor-toolbar [data-state="on"] svg,
        .markdown-editor .mdxeditor-toolbar [aria-pressed="true"] svg {
          color: hsl(var(--accent-foreground)) !important;
          stroke: hsl(var(--accent-foreground)) !important;
        }

        .markdown-editor .mdxeditor-toolbar button[data-state="on"] svg *,
        .markdown-editor .mdxeditor-toolbar [role="button"][data-state="on"] svg *,
        .markdown-editor .mdxeditor-toolbar [data-state="on"] svg *,
        .markdown-editor .mdxeditor-toolbar [aria-pressed="true"] svg * {
          stroke: hsl(var(--accent-foreground)) !important;
        }

        .markdown-editor .mdxeditor-toolbar button:hover,
        .markdown-editor .mdxeditor-toolbar [role="button"]:hover,
        .markdown-editor .mdxeditor-toolbar [data-radix-trigger]:hover {
          background: hsl(var(--accent));
          color: hsl(var(--accent-foreground));
        }

        .markdown-editor code:not(.cm-line code),
        .markdown-rendered-content code:not(.cm-line code) {
          background: hsl(var(--muted)) !important;
          color: hsl(var(--foreground)) !important;
          border: 1px solid hsl(var(--border));
          border-radius: 0.375rem;
          padding: 0.1rem 0.35rem;
        }

        .markdown-editor [contenteditable="true"] code,
        .markdown-editor [contenteditable="true"] code span,
        .markdown-editor [contenteditable="true"] span[style*="background-color"],
        .markdown-rendered-content code,
        .markdown-rendered-content code span,
        .markdown-rendered-content span[style*="background-color"] {
          background: transparent !important;
          background-color: transparent !important;
          color: hsl(var(--foreground)) !important;
        }

        .markdown-editor pre code,
        .markdown-rendered-content pre code,
        .markdown-editor .cm-content,
        .markdown-rendered-content .cm-content {
          background: transparent !important;
          border: 0;
          padding: 0;
        }

        .markdown-editor .mdxeditor-popup-container,
        .markdown-editor [role="dialog"],
        .markdown-editor [role="listbox"],
        .markdown-editor [role="menu"] {
          background: hsl(var(--popover));
          color: hsl(var(--popover-foreground));
          border-color: hsl(var(--border));
        }

        .markdown-editor .cm-editor,
        .markdown-rendered-content .cm-editor {
          background: hsl(var(--card));
          color: hsl(var(--foreground));
        }

        .markdown-editor .cm-scroller,
        .markdown-rendered-content .cm-scroller {
          background: hsl(var(--card));
          color: hsl(var(--foreground));
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }

        .markdown-editor .cm-gutters,
        .markdown-rendered-content .cm-gutters {
          background: hsl(var(--muted));
          color: hsl(var(--muted-foreground));
          border-right: 1px solid hsl(var(--border));
        }

        .markdown-editor .cm-activeLine,
        .markdown-rendered-content .cm-activeLine {
          background: hsl(var(--muted) / 0.45);
        }

        .markdown-editor .cm-activeLineGutter,
        .markdown-rendered-content .cm-activeLineGutter {
          background: hsl(var(--muted));
          color: hsl(var(--foreground));
        }

        .markdown-editor .cm-selectionBackground,
        .markdown-rendered-content .cm-selectionBackground {
          background: hsl(var(--primary) / 0.25) !important;
        }

        .markdown-editor .cm-cursor {
          border-left-color: hsl(var(--foreground));
        }

        .markdown-editor .cm-line,
        .markdown-rendered-content .cm-line {
          color: hsl(var(--foreground));
        }

        .markdown-editor .cm-content,
        .markdown-rendered-content .cm-content {
          caret-color: hsl(var(--foreground));
        }

        .markdown-editor .cm-line .tok-keyword,
        .markdown-rendered-content .cm-line .tok-keyword {
          color: #c678dd;
        }

        .markdown-editor .cm-line .tok-string,
        .markdown-rendered-content .cm-line .tok-string {
          color: #98c379;
        }

        .markdown-editor .cm-line .tok-number,
        .markdown-rendered-content .cm-line .tok-number {
          color: #d19a66;
        }

        .markdown-editor .cm-line .tok-comment,
        .markdown-rendered-content .cm-line .tok-comment {
          color: #7f848e;
          font-style: italic;
        }

        .markdown-editor .cm-line .tok-variableName,
        .markdown-rendered-content .cm-line .tok-variableName {
          color: #e5c07b;
        }

        .markdown-editor .cm-line .tok-function,
        .markdown-rendered-content .cm-line .tok-function {
          color: #61afef;
        }

        .markdown-editor .cm-line .tok-operator,
        .markdown-rendered-content .cm-line .tok-operator {
          color: #56b6c2;
        }

        .markdown-editor .cm-line .tok-punctuation,
        .markdown-rendered-content .cm-line .tok-punctuation {
          color: hsl(var(--muted-foreground));
        }

        .markdown-editor [class*="_codeMirrorWrapper"],
        .markdown-rendered-content [class*="_codeMirrorWrapper"] {
          border: 1px solid hsl(var(--border));
          border-radius: 1rem;
          overflow: hidden;
          background: hsl(var(--card));
        }

        .markdown-editor [class*="_selectTrigger"],
        .markdown-rendered-content [class*="_selectTrigger"] {
          background: hsl(var(--muted));
          color: hsl(var(--foreground));
          border-color: hsl(var(--border));
        }

        .markdown-editor [class*="_selectContent"],
        .markdown-rendered-content [class*="_selectContent"] {
          background: hsl(var(--popover));
          color: hsl(var(--popover-foreground));
          border-color: hsl(var(--border));
        }

        .markdown-editor [class*="_selectTrigger"],
        .markdown-rendered-content [class*="_selectTrigger"] {
          background: hsl(var(--muted)) !important;
          background-color: hsl(var(--muted)) !important;
          color: hsl(var(--foreground)) !important;
          border-color: hsl(var(--border)) !important;
        }

        .markdown-editor [class*="_selectTrigger"] svg,
        .markdown-rendered-content [class*="_selectTrigger"] svg {
          color: hsl(var(--foreground)) !important;
          stroke: hsl(var(--foreground)) !important;
        }

        .markdown-editor [class*="_selectTrigger"] span,
        .markdown-editor [class*="_selectTrigger"] div,
        .markdown-rendered-content [class*="_selectTrigger"] span,
        .markdown-rendered-content [class*="_selectTrigger"] div {
          color: hsl(var(--foreground)) !important;
        }

        .markdown-editor [class*="_selectTrigger"]:hover,
        .markdown-rendered-content [class*="_selectTrigger"]:hover {
          background: hsl(var(--accent)) !important;
          background-color: hsl(var(--accent)) !important;
          color: hsl(var(--accent-foreground)) !important;
        }

        .markdown-editor [class*="_selectTrigger"]:hover svg,
        .markdown-rendered-content [class*="_selectTrigger"]:hover svg {
          color: hsl(var(--accent-foreground)) !important;
          stroke: hsl(var(--accent-foreground)) !important;
        }

        .markdown-editor [class*="_selectTrigger"]:hover span,
        .markdown-editor [class*="_selectTrigger"]:hover div,
        .markdown-rendered-content [class*="_selectTrigger"]:hover span,
        .markdown-rendered-content [class*="_selectTrigger"]:hover div {
          color: hsl(var(--accent-foreground)) !important;
        }

        .markdown-editor [class*="_selectTrigger"]:hover,
        .markdown-rendered-content [class*="_selectTrigger"]:hover {
          background: hsl(var(--accent)) !important;
          background-color: hsl(var(--accent)) !important;
          color: hsl(var(--accent-foreground)) !important;
        }

        .markdown-editor [class*="_selectTrigger"]:hover *,
        .markdown-rendered-content [class*="_selectTrigger"]:hover * {
          color: hsl(var(--accent-foreground)) !important;
        }

        .markdown-editor [class*="_codeMirrorToolbar"],
        .markdown-editor [class*="_codeMirrorToolbar"] *,
        .markdown-rendered-content [class*="_codeMirrorToolbar"],
        .markdown-rendered-content [class*="_codeMirrorToolbar"] * {
          background-color: hsl(var(--accent)) !important;
        }

        [data-radix-popper-content-wrapper] > div {
          background: hsl(var(--popover)) !important;
          color: hsl(var(--popover-foreground)) !important;
          border: 1px solid hsl(var(--border)) !important;
          border-radius: 0.75rem !important;
          box-shadow: 0 18px 45px hsl(var(--foreground) / 0.12) !important;
          overflow: hidden !important;
        }

        [role="listbox"],
        [role="menu"] {
          background: hsl(var(--popover)) !important;
          color: hsl(var(--popover-foreground)) !important;
          border-color: hsl(var(--border)) !important;
        }

        [role="option"],
        [role="menuitem"] {
          background: transparent !important;
          color: hsl(var(--popover-foreground)) !important;
        }

        [role="option"]:hover,
        [role="option"][data-highlighted],
        [role="menuitem"]:hover,
        [role="menuitem"][data-highlighted] {
          background: hsl(var(--accent)) !important;
          color: hsl(var(--accent-foreground)) !important;
        }
      `}
    </style>

      <MDXEditor
        ref={editorRef}
        markdown={markdownForMdxEditor(props.value || "")}
        readOnly={!!props.disabled}
        placeholder={props.placeholder}
        onChange={(value) => {
          const nextValue = value || "";
          lastValueRef.current = nextValue;
          props.onChange(nextValue);
        }}
        contentEditableClassName="min-h-[140px] px-4 py-3 text-sm text-foreground outline-none"
        plugins={plugins}
      />
    </div>
  );
}