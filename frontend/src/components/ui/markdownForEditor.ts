import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export const markdownSyntaxPolicy = {
  disable: { null: ["htmlFlow", "htmlText", "highlight"] },
};

export const allowedMarkdownNodes = new Set([
  "root", "paragraph", "text", "break", "emphasis", "strong", "delete",
  "link", "heading", "list", "listItem", "blockquote", "table", "tableRow",
  "tableCell", "code", "inlineCode", "thematicBreak",
]);

export function shouldOpenMarkdownEditorLink(event: {
  ctrlKey: boolean;
  metaKey: boolean;
}, isLinkPreview = false) {
  return isLinkPreview || event.ctrlKey || event.metaKey;
}

export function shouldDeferMarkdownSync(nextValue: string, lastValue: string, focused: boolean) {
  return focused && !(nextValue === "" && lastValue !== "");
}

export function markdownForMdxEditor(value: string) {
  const source = String(value || "");
  const tree = fromMarkdown(source, {
    extensions: [gfm(), markdownSyntaxPolicy],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const replacements: { start: number; end: number; text: string }[] = [];

  function visit(node: {
    type: string;
    position?: { start: { offset?: number }; end: { offset?: number } };
    children?: typeof tree.children;
  }) {
    if (!allowedMarkdownNodes.has(node.type)) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        replacements.push({
          start,
          end,
          text: source.slice(start, end).replace(/[!-/:-@\[-`{-~]/g, "\\$&"),
        });
      }
      return;
    }
    node.children?.forEach(visit);
  }

  visit(tree);
  const first = tree.children[0];
  if (first?.type === "code") {
    const start = first.position?.start.offset;
    const end = first.position?.end.offset;
    if (start !== undefined && end !== undefined && !/^ {0,3}(?:`{3,}|~{3,})/.test(source.slice(start, end))) {
      let fenceLength = 3;
      for (const match of first.value.matchAll(/`+/g)) {
        fenceLength = Math.max(fenceLength, match[0].length + 1);
      }
      const fence = "`".repeat(fenceLength);
      replacements.unshift({ start, end, text: `${fence}\n${first.value}\n${fence}` });
    }
  }
  let result = source;
  for (const { start, end, text } of replacements.reverse()) {
    result = result.slice(0, start) + text + result.slice(end);
  }
  return result;
}
