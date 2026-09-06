import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";

import * as markdownEditorHelpers from "../src/components/ui/markdownForEditor.ts";

const { markdownForMdxEditor } = markdownEditorHelpers;

test("external clearing is applied even while focus is retained after submission", () => {
  const defer = markdownEditorHelpers.shouldDeferMarkdownSync;
  assert.equal(defer("", "Submitted comment", true), false);
  assert.equal(defer("External change", "Draft in progress", true), true);
  assert.equal(defer("External change", "Draft in progress", false), false);
  assert.equal(defer("", "", true), true);
});
const markdownEditorSource = readFileSync(
  new URL("../src/components/ui/MarkdownEditor.tsx", import.meta.url),
  "utf8",
);

test("keeps fenced and inline code unchanged", () => {
  const value = "`const value = { raw: '<tag' }`\n\n```html\n<div>{value}</div>\n```";

  assert.equal(markdownForMdxEditor(value), value);
});

test("treats HTML as literal text without converting it to Markdown", () => {
  const value = [
    "<u>underlined</u>",
    "<sup>superscript</sup>",
    "<sub>subscript</sub>",
    "<strong>bold</strong>",
    "tototo<br>",
    "<script>alert('test')</script>",
  ].join("\n");

  const parsed = nodes(parse(markdownForMdxEditor(value)));
  assert.equal(parsed.some(node => node.type === "html"), false);
  assert.equal(parsed.filter(node => node.type === "text").map(node => node.value).join(""), value);
});

test("preserves supported Markdown and autolinks", () => {
  const value = [
    "# Heading",
    "**bold** *italic* ~~strikethrough~~ `code`",
    "- item",
    "> quote",
    "[link](https://example.com)",
    "<https://example.com>",
    "----------",
    "",
    "| Column |",
    "| --- |",
    "| Value |",
  ].join("\n");

  assert.equal(markdownForMdxEditor(value), value);
});

test("opens editor links only with Ctrl or Command", () => {
  const shouldOpen = markdownEditorHelpers.shouldOpenMarkdownEditorLink;

  assert.equal(shouldOpen({ ctrlKey: false, metaKey: false }), false);
  assert.equal(shouldOpen({ ctrlKey: true, metaKey: false }), true);
  assert.equal(shouldOpen({ ctrlKey: false, metaKey: true }), true);
});

test("allows explicit navigation from the link preview without modifier keys", () => {
  assert.equal(markdownEditorHelpers.shouldOpenMarkdownEditorLink(
    { ctrlKey: false, metaKey: false }, true,
  ), true);
  assert.equal(markdownEditorHelpers.shouldOpenMarkdownEditorLink(
    { ctrlKey: false, metaKey: false }, false,
  ), false);
});

function parse(value) {
  return fromMarkdown(value, { extensions: [gfm(), markdownEditorHelpers.markdownSyntaxPolicy], mdastExtensions: [gfmFromMarkdown()] });
}

function nodes(tree) {
  return [tree, ...(tree.children || []).flatMap(nodes)];
}

test("reopening escaped markup does not add escapes or reactivate HTML", () => {
  for (const value of [String.raw`\<u>text\</u>`, "<div>{value}</div>", "<?xml version=\"1.0\"?>", "<!--\ncomment\n-->"]) {
    const once = markdownForMdxEditor(value);
    assert.equal(markdownForMdxEditor(once), once);
    assert.equal(nodes(parse(once)).some(node => node.type === "html"), false);
  }
});

test("preserves code inside long fences, indentation, lists and quotes", () => {
  for (const value of [
    "````html\n```\n<div>{value}</div>\n````",
    "~~~~xml\n~~~\n<?xml version=\"1.0\"?>\n~~~~",
    "> ```html\n> <script>alert(1)</script>\n> ```",
    "- item\n\n  ```html\n  <div>{x}</div>\n  ```",
    "``line one\n<div>{x}</div>\nline three``",
    "```python\nif a < b and c > d:\n    print(\"ok\")",
  ]) {
    assert.equal(markdownForMdxEditor(value), value);
  }
});

test("initial indented code survives the editor's initial whitespace trimming", () => {
  for (const value of ["    plain text\n    second line", "    <div>{value}</div>", "    ```\n    nested fence", "\n\tcode"]) {
    const parsed = parse(markdownForMdxEditor(value).trim());
    assert.equal(parsed.children[0].type, "code");
    assert.equal(parsed.children[0].value, parse(value).children[0].value);
  }
});

test("large indented snippets do not overflow when choosing a code fence", () => {
  const value = "    " + "` ".repeat(150000);
  const normalized = markdownForMdxEditor(value);
  assert.equal(parse(normalized).children[0].value, value.slice(4));
});

test("unsupported images and reference syntax stay visible as literal text", () => {
  for (const value of ["![image](https://example.com/image.png)", "[link][id]\n\n[id]: https://example.com", "[^note]\n\n[^note]: details"]) {
    const normalized = markdownForMdxEditor(value);
    const parsed = nodes(parse(normalized));
    assert.equal(parsed.some(node => ["image", "linkReference", "definition", "footnoteReference", "footnoteDefinition"].includes(node.type)), false);
    assert.equal(markdownForMdxEditor(normalized), normalized);
    const visible = parse(normalized).children.map(child => nodes(child).filter(node => node.type === "text").map(node => node.value).join("")).join("\n\n");
    assert.equal(visible, value);
  }
});

test("styles the link preview for dark mode without changing read-only links", () => {
  assert.match(
    markdownEditorSource,
    /\[data-radix-popper-content-wrapper\] \[data-testid="link-dialog-preview"\][\s\S]*?color: hsl\(var\(--popover-foreground\)\) !important;/,
  );
  assert.match(
    markdownEditorSource,
    /\[data-radix-popper-content-wrapper\] \[class\*="_linkDialogPopoverContent"\] > \[class\*="_actionButton"\][\s\S]*?padding: 0\.125rem !important;/,
  );
  assert.doesNotMatch(
    markdownEditorSource,
    /\.markdown-rendered-content \[data-testid="link-dialog-preview"\]/,
  );
});

test("uses theme colors for every field in the link edit popup", () => {
  assert.match(
    markdownEditorSource,
    /\[data-radix-popper-content-wrapper\] form\[class\*="_linkDialogEditForm"\] input[\s\S]*?background: hsl\(var\(--background\)\) !important;[\s\S]*?color: hsl\(var\(--foreground\)\) !important;/,
  );
  assert.match(
    markdownEditorSource,
    /\[data-radix-popper-content-wrapper\] form\[class\*="_linkDialogEditForm"\] label[\s\S]*?color: hsl\(var\(--popover-foreground\)\) !important;/,
  );
});

test("uses Doko save and cancel controls in the link edit popup", () => {
  assert.match(
    markdownEditorSource,
    /\[data-radix-popper-content-wrapper\] form\[class\*="_linkDialogEditForm"\] button\[type="submit"\][\s\S]*?background: rgb\(21 128 61\);/,
  );
  assert.match(
    markdownEditorSource,
    /\[data-radix-popper-content-wrapper\] form\[class\*="_linkDialogEditForm"\] button\[type="reset"\][\s\S]*?color: rgb\(180 83 9\);/,
  );
  assert.match(markdownEditorSource, /button\[type="submit"\]::before/);
  assert.match(markdownEditorSource, /button\[type="reset"\]::before/);
});
