import { useEffect, useMemo, useRef, useState } from "react";
import {
  MDXEditor,
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
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import "./markdownCodeBlocks.css";
import { markdownCodeBlockExtensions } from "./markdownCodeBlocks";
import { markdownForMdxEditor, shouldOpenMarkdownEditorLink } from "./markdownForEditor";
import { strictMarkdownPlugin } from "./strictMarkdownPlugin";
import { markdownLinkActionsPlugin, textLinksPlugin, type MarkdownLinkAction, type MarkdownLinkController } from "./markdownLinks";
import "./markdownLinks.css";

type Props = {
  markdown: string;
  className?: string;
  requireLinkModifier?: boolean;
  onEditLink?: (request: MarkdownLinkAction) => void;
  linksAsText?: boolean;
};

export default function MarkdownRenderedContent(props: Props) {
  return <MarkdownReadOnly key={props.markdown} {...props} />;
}

function MarkdownReadOnly(props: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const linkController = useRef<MarkdownLinkController | null>(null);
  const selectedLink = useRef<Omit<MarkdownLinkAction, "action"> | null>(null);
  const [parseFailed, setParseFailed] = useState(false);
  const content = useMemo(() => {
    try {
      return markdownForMdxEditor(props.markdown || "");
    } catch {
      return null;
    }
  }, [props.markdown]);
  const plugins = useMemo(
    () => [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      props.linksAsText ? textLinksPlugin() : linkPlugin(),
      ...(props.requireLinkModifier ? [
        linkDialogPlugin(),
        markdownLinkActionsPlugin({ onReady: controller => { linkController.current = controller; } }),
      ] : []),
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
      strictMarkdownPlugin(),
    ],
    [props.requireLinkModifier, props.linksAsText],
  );

  useEffect(() => {
    if (!props.requireLinkModifier) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (linkController.current?.containsPopup(target)) return;
      if (rootRef.current?.contains(target) && target.closest("a[href]")) return;
      linkController.current?.close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") linkController.current?.close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      linkController.current?.close();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [props.requireLinkModifier]);

  return (
    <div
      ref={rootRef}
      onClickCapture={(event) => {
        if (!props.requireLinkModifier) return;
        const button = (event.target as Element | null)?.closest("button[aria-label]");
        const label = button?.getAttribute("aria-label");
        if (button?.closest('[class*="_linkDialogPopoverContent"]') && (label === "Edit link URL" || label === "Remove link")) {
          event.preventDefault();
          event.stopPropagation();
          if (selectedLink.current) props.onEditLink?.({ ...selectedLink.current, action: label === "Remove link" ? "remove" : "edit" });
          return;
        }
        const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
        if (!link || shouldOpenMarkdownEditorLink(event, link.matches('[data-testid="link-dialog-preview"]'))) return;
        event.preventDefault();
        const root = rootRef.current;
        if (!root) return;
        const index = Array.from(root.querySelectorAll("[contenteditable] a[href]")).indexOf(link);
        if (index < 0) return;
        selectedLink.current = { index, url: link.getAttribute("href") || "" };
        linkController.current?.preview(link);
      }}
      className={[
        "markdown-rendered-content rounded-2xl border border-border bg-card text-sm text-foreground shadow-sm",
        props.className || "",
      ].join(" ")}
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

        .markdown-editor .mdxeditor-toolbar button,
        .markdown-editor .mdxeditor-toolbar [role="button"],
        .markdown-editor .mdxeditor-toolbar select,
        .markdown-editor .mdxeditor-toolbar [data-radix-trigger] {
          color: hsl(var(--foreground));
          background: transparent;
        }

        .markdown-editor .mdxeditor-toolbar button:hover,
        .markdown-editor .mdxeditor-toolbar [role="button"]:hover,
        .markdown-editor .mdxeditor-toolbar [data-radix-trigger]:hover {
          background: hsl(var(--accent));
          color: hsl(var(--accent-foreground));
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

        [data-radix-popper-content-wrapper] {
          background: transparent !important;
          box-shadow: none !important;
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

      {parseFailed || content === null ? (
        <div className="whitespace-pre-wrap break-words px-4 py-3 text-sm text-foreground">
          {props.markdown}
        </div>
      ) : <MDXEditor
        markdown={content}
        className={props.requireLinkModifier && !props.onEditLink ? "doko-link-readonly-locked" : undefined}
        suppressHtmlProcessing
        readOnly
        plugins={plugins}
        onError={() => setParseFailed(true)}
        contentEditableClassName="px-4 py-3 text-sm text-foreground outline-none"
      />}
    </div>
  );
}
