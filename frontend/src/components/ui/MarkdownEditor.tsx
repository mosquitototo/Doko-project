import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  thematicBreakPlugin,
  toolbarPlugin,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import "./markdownCodeBlocks.css";
import { markdownCodeBlockExtensions } from "./markdownCodeBlocks";
import { strictMarkdownPlugin } from "./strictMarkdownPlugin";
import {
  markdownForMdxEditor,
  shouldOpenMarkdownEditorLink,
  shouldDeferMarkdownSync,
} from "./markdownForEditor";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onEditorBlur?: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

export default function MarkdownEditor(props: Props) {
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const synchronizedEditorRef = useRef<MDXEditorMethods | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastValueRef = useRef(props.value || "");
  const focusedRef = useRef(false);
  const skipNextBlurRef = useRef(false);
  const applyingExternalValueRef = useRef(true);
  const failedValueRef = useRef("");
  const parseFailureScheduledRef = useRef(false);
  const [editorReady, setEditorReady] = useState(false);
  const [parseFailed, setParseFailed] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(false);

  const attachEditor = useCallback((editor: MDXEditorMethods | null) => {
    editorRef.current = editor;
    if (!editor) {
      synchronizedEditorRef.current = null;
    }
    setEditorReady(!!editor);
  }, []);


  const plugins = useMemo(
    () => [
      headingsPlugin(),
      listsPlugin(),
      linkDialogPlugin(),
      quotePlugin(),
      linkPlugin(),
      tablePlugin(),
      thematicBreakPlugin(),
      markdownShortcutPlugin(),
      codeBlockPlugin({
        defaultCodeBlockLanguage: "plaintext",
      }),
      codeMirrorPlugin({
        codeMirrorExtensions: markdownCodeBlockExtensions,
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
            <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
            <StrikeThroughSupSubToggles options={["Strikethrough"]} />
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
      strictMarkdownPlugin(),
    ],
    [],
  );

  useEffect(() => {
    const nextValue = props.value || "";
    const root = rootRef.current;
    const activeElement = document.activeElement;
    const editor = editorRef.current;

    if (shouldDeferMarkdownSync(
      nextValue,
      lastValueRef.current,
      focusedRef.current || !!(root && activeElement && root.contains(activeElement)),
    )) return;

    if (!editor) return;

    if (
      synchronizedEditorRef.current !== editor ||
      nextValue !== lastValueRef.current
    ) {
      applyingExternalValueRef.current = true;
      lastValueRef.current = nextValue;
      editor.setMarkdown(markdownForMdxEditor(nextValue));
      synchronizedEditorRef.current = editor;

      const frame = window.requestAnimationFrame(() => {
        applyingExternalValueRef.current = false;
      });

      return () => {
        window.cancelAnimationFrame(frame);
        applyingExternalValueRef.current = false;
      };
    }

    applyingExternalValueRef.current = false;
  }, [editorReady, props.value]);

  useEffect(() => {
    if (!parseFailed || focusedRef.current) return;
    if ((props.value || "") === failedValueRef.current) return;

    applyingExternalValueRef.current = true;
    setParseFailed(false);
  }, [parseFailed, props.value]);



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
      onClickCapture={(event) => {
        const target = event.target as Element | null;
        const link = target?.closest("a[href]");
        if (!link) return;
        if (shouldOpenMarkdownEditorLink(event, link.matches('[data-testid="link-dialog-preview"]'))) return;
        event.preventDefault();
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

        .markdown-editor .mdxeditor [contenteditable],
        .markdown-rendered-content .mdxeditor [contenteditable] {
          color: inherit;
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
          color: var(--code-keyword);
        }

        .markdown-editor .cm-line .tok-string,
        .markdown-rendered-content .cm-line .tok-string {
          color: var(--code-string);
        }

        .markdown-editor .cm-line .tok-number,
        .markdown-rendered-content .cm-line .tok-number {
          color: var(--code-number);
        }

        .markdown-editor .cm-line .tok-comment,
        .markdown-rendered-content .cm-line .tok-comment {
          color: var(--code-comment);
          font-style: italic;
        }

        .markdown-editor .cm-line .tok-variableName,
        .markdown-rendered-content .cm-line .tok-variableName {
          color: var(--code-variable);
        }

        .markdown-editor .cm-line .tok-function,
        .markdown-rendered-content .cm-line .tok-function {
          color: var(--code-function);
        }

        .markdown-editor .cm-line .tok-operator,
        .markdown-rendered-content .cm-line .tok-operator {
          color: var(--code-operator);
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

        [data-radix-popper-content-wrapper] [class*="_linkDialogPopoverContent"] {
          background: hsl(var(--popover)) !important;
          color: hsl(var(--popover-foreground)) !important;
          border-color: hsl(var(--border)) !important;
        }

        [data-radix-popper-content-wrapper] [class*="_linkDialogPopoverContent"]:has([data-testid="link-dialog-preview"]) {
          gap: 0.125rem !important;
          padding: 0.125rem 0.25rem !important;
        }

        [data-radix-popper-content-wrapper] [data-testid="link-dialog-preview"] {
          color: hsl(var(--popover-foreground)) !important;
          line-height: 1.125rem;
          margin-right: 0.125rem !important;
        }

        [data-radix-popper-content-wrapper] [data-testid="link-dialog-preview"]:hover {
          color: hsl(var(--primary)) !important;
        }

        [data-radix-popper-content-wrapper] [data-testid="link-dialog-preview"] svg {
          width: 0.875rem;
          height: 0.875rem;
          color: currentColor !important;
          stroke: currentColor !important;
        }

        [data-radix-popper-content-wrapper] [class*="_linkDialogPopoverContent"] > [class*="_actionButton"] {
          padding: 0.125rem !important;
          color: hsl(var(--popover-foreground)) !important;
          line-height: 0;
          border-radius: 0.375rem;
        }

        [data-radix-popper-content-wrapper] [class*="_linkDialogPopoverContent"] > [class*="_actionButton"] svg {
          width: 1rem;
          height: 1rem;
          color: currentColor !important;
          stroke: currentColor !important;
        }

        [data-radix-popper-content-wrapper] [class*="_linkDialogPopoverContent"] > [class*="_actionButton"] svg * {
          stroke: currentColor !important;
        }

        [data-radix-popper-content-wrapper] [class*="_linkDialogPopoverContent"] > [class*="_actionButton"]:hover {
          background: hsl(var(--accent)) !important;
          color: hsl(var(--accent-foreground)) !important;
        }

        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] label {
          color: hsl(var(--popover-foreground)) !important;
        }

        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] [class*="_linkDialogInputWrapper"],
        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] input {
          background: hsl(var(--background)) !important;
          color: hsl(var(--foreground)) !important;
          border-color: hsl(var(--border)) !important;
        }

        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] input::placeholder {
          color: hsl(var(--muted-foreground)) !important;
        }

        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="submit"],
        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="reset"] {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 2.5rem;
          height: 2.5rem;
          min-height: 0;
          padding: 0 !important;
          border-radius: 0.75rem;
          font-size: 0 !important;
          cursor: pointer;
          box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
          transition: transform 200ms, background-color 200ms, border-color 200ms, box-shadow 200ms;
        }

        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="submit"] {
          border: 0;
          background: rgb(21 128 61);
          color: white;
        }

        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="submit"]:hover {
          background: rgb(22 101 52);
          transform: translateY(-0.125rem);
          box-shadow: 0 4px 6px rgb(0 0 0 / 0.12);
        }

        .dark [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="submit"] {
          background: rgb(22 101 52);
        }

        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="reset"] {
          border: 1px solid rgb(253 230 138 / 0.5);
          background: rgb(255 251 235 / 0.5);
          color: rgb(180 83 9);
        }

        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="reset"]:hover {
          border-color: rgb(252 211 77);
          background: rgb(254 243 199 / 0.8);
          transform: translateY(-0.125rem);
          box-shadow: 0 4px 6px rgb(0 0 0 / 0.08);
        }

        .dark [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="reset"] {
          border-color: rgb(245 158 11 / 0.1);
          background: rgb(245 158 11 / 0.05);
          color: rgb(251 191 36);
        }

        .dark [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="reset"]:hover {
          border-color: rgb(245 158 11 / 0.2);
          background: rgb(245 158 11 / 0.1);
        }

        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="submit"]:focus-visible,
        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="reset"]:focus-visible {
          outline: 2px solid hsl(var(--ring));
          outline-offset: 2px;
        }

        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="submit"]:disabled,
        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="reset"]:disabled {
          cursor: not-allowed;
          opacity: 0.5;
          transform: none;
        }

        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="submit"]::before,
        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="reset"]::before {
          content: "";
          display: block;
          width: 1rem;
          height: 1rem;
          background: currentColor;
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
          -webkit-mask-position: center;
          mask-position: center;
          -webkit-mask-size: contain;
          mask-size: contain;
        }

        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="submit"]::before {
          -webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='black'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M19%2021H5a2%202%200%200%201-2-2V5a2%202%200%200%201%202-2h11l5%205v11a2%202%200%200%201-2%202Z'/%3E%3Cpath%20d='M17%2021v-8H7v8'/%3E%3Cpath%20d='M7%203v5h8'/%3E%3C/svg%3E");
          mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='black'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M19%2021H5a2%202%200%200%201-2-2V5a2%202%200%200%201%202-2h11l5%205v11a2%202%200%200%201-2%202Z'/%3E%3Cpath%20d='M17%2021v-8H7v8'/%3E%3Cpath%20d='M7%203v5h8'/%3E%3C/svg%3E");
        }

        [data-radix-popper-content-wrapper] form[class*="_linkDialogEditForm"] button[type="reset"]::before {
          -webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='black'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Ccircle%20cx='12'%20cy='12'%20r='10'/%3E%3Cpath%20d='m15%209-6%206'/%3E%3Cpath%20d='m9%209%206%206'/%3E%3C/svg%3E");
          mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='black'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Ccircle%20cx='12'%20cy='12'%20r='10'/%3E%3Cpath%20d='m15%209-6%206'/%3E%3Cpath%20d='m9%209%206%206'/%3E%3C/svg%3E");
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

      {parseFailed ? (
        <textarea
          value={props.value || ""}
          readOnly={!!props.disabled}
          placeholder={props.placeholder}
          onChange={(event) => {
            const nextValue = event.target.value;
            failedValueRef.current = nextValue;
            lastValueRef.current = nextValue;
            props.onChange(nextValue);
          }}
          className="min-h-[140px] w-full resize-y border-0 bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
      ) : (
        <MDXEditor
          ref={attachEditor}
          markdown={markdownForMdxEditor(props.value || "")}
          suppressHtmlProcessing
          readOnly={!!props.disabled}
          placeholder={props.placeholder}
          onChange={(value) => {
            if (applyingExternalValueRef.current) return;
            const nextValue = value || "";
            lastValueRef.current = nextValue;
            props.onChange(nextValue);
          }}
          onError={() => {
            if (parseFailureScheduledRef.current) return;
            parseFailureScheduledRef.current = true;
            failedValueRef.current = props.value || "";
            window.queueMicrotask(() => {
              setParseFailed(true);
              parseFailureScheduledRef.current = false;
            });
          }}
          contentEditableClassName="min-h-[140px] px-4 py-3 text-sm text-foreground outline-none"
          plugins={plugins}
        />
      )}
    </div>
  );
}
