import assert from "node:assert/strict";
import test from "node:test";
import { createEditor, $getRoot, $createParagraphNode, $createTextNode, FORMAT_TEXT_COMMAND, PASTE_COMMAND } from "lexical";
import { registerMarkdownEditorPolicy } from "../src/components/ui/markdownEditorPolicy.ts";

test("pasted text keeps supported formatting while rejecting HTML-only formats and styles", () => {
  const editor = createEditor({ onError: error => { throw error; } });
  const cleanup = registerMarkdownEditorPolicy(editor);
  editor.update(() => {
    const text = $createTextNode("literal");
    for (const format of ["bold", "italic", "underline", "superscript", "highlight"]) text.toggleFormat(format);
    text.setStyle("color:red");
    $getRoot().append($createParagraphNode().append(text));
  }, { discrete: true });
  editor.getEditorState().read(() => {
    const text = $getRoot().getAllTextNodes()[0];
    assert.equal(text.getTextContent(), "literal");
    assert.equal(text.hasFormat("bold"), true);
    assert.equal(text.hasFormat("italic"), true);
    assert.equal(text.hasFormat("underline"), false);
    assert.equal(text.hasFormat("superscript"), false);
    assert.equal(text.hasFormat("highlight"), false);
    assert.equal(text.getStyle(), "");
  });
  assert.equal(editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline"), true);
  assert.equal(editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold"), false);
  cleanup();
});

test("paste inside inline code preserves Markdown punctuation literally", () => {
  const editor = createEditor({ onError: error => { throw error; } });
  const cleanup = registerMarkdownEditorPolicy(editor);
  let prevented = false;
  editor.update(() => {
    const text = $createTextNode("code").toggleFormat("code");
    $getRoot().append($createParagraphNode().append(text));
    text.selectEnd().toggleFormat("code");
    assert.equal(editor.dispatchCommand(PASTE_COMMAND, {
      clipboardData: { getData: type => type === "text/plain" ? "**literal** <script>x</script>" : "" },
      preventDefault: () => { prevented = true; },
    }), true);
  }, { discrete: true });
  editor.getEditorState().read(() => {
    assert.equal($getRoot().getTextContent(), "code**literal** <script>x</script>");
    assert.equal($getRoot().getAllTextNodes().every(node => node.hasFormat("code")), true);
  });
  assert.equal(prevented, true);
  cleanup();
});
