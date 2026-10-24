import assert from "node:assert/strict";
import test from "node:test";
import { Realm } from "@mdxeditor/gurx";
import { createEditor, $getRoot } from "lexical";
import { corePlugin, codeBlockPlugin, codeMirrorPlugin, codeBlockEditorDescriptors$, importMarkdownToLexical, importVisitors$, syntaxExtensions$, mdastExtensions$, usedLexicalNodes$ } from "@mdxeditor/editor";
import { textLinksPlugin } from "../src/components/ui/markdownLinks.ts";
import { markdownForMdxEditor } from "../src/components/ui/markdownForEditor.ts";

function render(markdown) {
  const realm = new Realm();
  for (const plugin of [corePlugin({ suppressHtmlProcessing: true }), codeBlockPlugin(), codeMirrorPlugin(), textLinksPlugin()]) plugin.init(realm);
  const editor = createEditor({ nodes: realm.getValue(usedLexicalNodes$), onError: error => { throw error; } });
  editor.update(() => importMarkdownToLexical({
    root: $getRoot(), markdown: markdownForMdxEditor(markdown),
    visitors: realm.getValue(importVisitors$), syntaxExtensions: realm.getValue(syntaxExtensions$),
    mdastExtensions: realm.getValue(mdastExtensions$), jsxComponentDescriptors: [], jsxIsAvailable: false,
    codeBlockEditorDescriptors: realm.getValue(codeBlockEditorDescriptors$),
  }), { discrete: true });
  return editor.getEditorState().read(() => ({ text: $getRoot().getTextContent(), children: $getRoot().getChildren().map(node => ({ type: node.getType(), code: node.getCode?.(), children: node.getChildren?.().map(child => ({ type: child.getType(), text: child.getTextContent(), bold: child.hasFormat?.("bold"), code: child.hasFormat?.("code") })) })) }));
}

test("Catbot link labels are ordinary text and retain their Markdown formatting", () => {
  const result = render("[**Example label**](https://example.com)");
  assert.equal(result.text, "Example label");
  assert.deepEqual(result.children[0].children, [{ type: "text", text: "Example label", bold: true, code: false }]);
});

test("Catbot bare URLs and angle-bracket links have no link node", () => {
  for (const markdown of ["https://example.com", "<https://example.com>"]) {
    const result = render(markdown);
    assert.equal(result.text, "https://example.com");
    assert.equal(result.children[0].children[0].type, "text");
  }
});

test("Catbot URL rendering does not rewrite inline or fenced code", () => {
  const inline = render("`[literal](https://example.com)`");
  assert.equal(inline.text, "[literal](https://example.com)");
  assert.equal(inline.children[0].children[0].code, true);
  const fenced = render("```text\n[literal](https://example.com)\n```");
  assert.equal(fenced.children[0].type, "codeblock");
  assert.equal(fenced.children[0].code, "[literal](https://example.com)");
});
