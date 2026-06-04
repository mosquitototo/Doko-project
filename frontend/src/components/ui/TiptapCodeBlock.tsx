import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useRef } from "react";
import { CopyButton } from "./IconButton";

const LANGUAGES = [
  { value: "plaintext", label: "Plain text" },
  { value: "bash", label: "Bash" },
  { value: "powershell", label: "PowerShell" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "sql", label: "SQL" },
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "xml", label: "XML" },
  { value: "ini", label: "INI" },
];


export default function TiptapCodeBlock(props: NodeViewProps) {
  const language = props.node.attrs.language || "plaintext";
  const isEditable = props.editor.isEditable;
  const codeRef = useRef<HTMLPreElement | null>(null);

  const copyCode = async () => {
    if (!codeRef.current) return;

    try {
      const text = codeRef.current.innerText;
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
  };

  return (
    <NodeViewWrapper className="group relative my-3 overflow-hidden rounded-2xl border border-border bg-muted/50 shadow-panel">
      <div
        className="flex items-center justify-between bg-muted px-3 py-2"
        contentEditable={false}
      >
        <div className="ml-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Code block
        </div>

        <div className="flex items-center gap-2">
          <select
            className="rounded-xl bg-background px-2 py-1 text-xs text-foreground outline-none transition hover:bg-accent focus:ring-2 focus:ring-ring/20 disabled:cursor-default disabled:opacity-100"
            value={language}
            disabled={!isEditable}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            onChange={(e) => {
              if (!isEditable) return;

              props.updateAttributes({
                language: e.target.value,
              });
            }}
          >
            {LANGUAGES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>

          <CopyButton
            onClick={copyCode}
            title="Copy code"
            className="opacity-70 transition hover:opacity-100"
          />
        </div>
      </div>

      <pre
        ref={codeRef}
        className="overflow-x-auto bg-card text-[13px] leading-5 text-foreground"
      >
        <code className="block">
          <NodeViewContent
            className="block px-5 py-5"
            spellCheck={false}
            contentEditable={isEditable}
          />
        </code>
      </pre>
    </NodeViewWrapper>
  );
}