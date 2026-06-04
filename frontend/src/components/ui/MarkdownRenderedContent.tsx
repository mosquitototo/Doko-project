import { useMemo } from "react";
import {
  MDXEditor,
  codeBlockPlugin,
  codeMirrorPlugin,
  headingsPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";

type Props = {
  markdown: string;
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

export default function MarkdownRenderedContent(props: Props) {
  const plugins = useMemo(
    () => [
      headingsPlugin(),
      listsPlugin(),
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
    ],
    [],
  );

  return (
    <div
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

      <MDXEditor
        markdown={markdownForMdxEditor(props.markdown || "")}
        readOnly
        plugins={plugins}
        contentEditableClassName="px-4 py-3 text-sm text-foreground outline-none"
      />
    </div>
  );
}