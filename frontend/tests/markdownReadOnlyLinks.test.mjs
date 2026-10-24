import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import { parse } from "@babel/parser";
import { shouldOpenMarkdownEditorLink } from "../src/components/ui/markdownForEditor.ts";

const source = readFileSync(new URL("../src/components/ui/MarkdownRenderedContent.tsx", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
let handler;
function visit(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "JSXAttribute" && node.name?.name === "onClickCapture") handler = source.slice(node.value.expression.start, node.value.expression.end);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") visit(value);
  }
}
visit(ast);

test("protected read-only links block plain clicks but retain deliberate Ctrl/Cmd opening", () => {
  const click = runInNewContext(stripTypeScriptTypes(`(${handler})`), { props: { requireLinkModifier: true }, rootRef: { current: null }, shouldOpenMarkdownEditorLink });
  for (const [ctrlKey, metaKey, link, expected] of [
    [false, false, {}, true],
    [true, false, {}, false],
    [false, true, {}, false],
    [false, false, null, false],
  ]) {
    let prevented = false;
    click({ ctrlKey, metaKey, target: { closest: selector => selector === "a[href]" && link ? { matches: () => false } : null }, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, expected);
  }
});

test("explicit opening from the existing preview is allowed without a modifier", () => {
  const click = runInNewContext(stripTypeScriptTypes(`(${handler})`), { props: { requireLinkModifier: true }, shouldOpenMarkdownEditorLink });
  let prevented = false;
  click({ ctrlKey: false, metaKey: false, target: { closest: selector => selector === "a[href]" ? { matches: () => true } : null }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});

test("preview mutations hand the selected occurrence to the existing edit workflow", () => {
  for (const [label, action] of [["Edit link URL", "edit"], ["Remove link", "remove"]]) {
    let request, prevented = false, stopped = false;
    const click = runInNewContext(stripTypeScriptTypes(`(${handler})`), {
      props: { requireLinkModifier: true, onEditLink: value => { request = value; } },
      selectedLink: { current: { index: 2, url: "https://example.com" } }, shouldOpenMarkdownEditorLink,
    });
    click({ target: { closest: () => ({ getAttribute: () => label, closest: () => ({}) }) }, preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
    assert.deepEqual(JSON.parse(JSON.stringify(request)), { index: 2, url: "https://example.com", action });
    assert.equal(prevented && stopped, true);
  }
});

test("a preview without edit permission never invokes the editor mutation", () => {
  const click = runInNewContext(stripTypeScriptTypes(`(${handler})`), { props: { requireLinkModifier: true }, selectedLink: { current: { index: 0, url: "https://example.com" } }, shouldOpenMarkdownEditorLink });
  let stopped = false;
  click({ target: { closest: () => ({ getAttribute: () => "Remove link", closest: () => ({}) }) }, preventDefault() {}, stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
});

test("consultation identifies the clicked occurrence when two links share a URL", () => {
  const first = {};
  const second = { matches: () => false, getAttribute: () => "https://example.com" };
  const selectedLink = { current: null };
  let preview;
  const click = runInNewContext(stripTypeScriptTypes(`(${handler})`), {
    props: { requireLinkModifier: true }, shouldOpenMarkdownEditorLink, selectedLink,
    rootRef: { current: { querySelectorAll: () => [first, second] } },
    linkController: { current: { preview: value => { preview = value; } } },
  });
  click({ target: { closest: selector => selector === "a[href]" ? second : null }, preventDefault() {} });
  assert.equal(selectedLink.current.index, 1);
  assert.equal(selectedLink.current.url, "https://example.com");
  assert.equal(preview, second);
});

test("read-only links outside the requested scope keep their existing behavior", () => {
  const click = runInNewContext(stripTypeScriptTypes(`(${handler})`), { props: {}, shouldOpenMarkdownEditorLink });
  let prevented = false;
  click({ ctrlKey: false, metaKey: false, target: { closest: () => ({}) }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});
