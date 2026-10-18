import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";

test("persistent toolbar stays visible after blur without changing default editors", () => {
  const source = readFileSync(new URL("../src/components/ui/MarkdownEditor.tsx", import.meta.url), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  let expression;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXAttribute" && node.name?.name === "data-toolbar-visible") expression = source.slice(node.value.expression.start, node.value.expression.end);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(ast);
  for (const [persistent, focused, expected] of [[true, false, "true"], [false, false, "false"], [false, true, "true"]]) {
    assert.equal(runInNewContext(expression, { props: { alwaysShowToolbar: persistent }, toolbarVisible: focused }), expected);
  }
});

test("compact indicators initially show five rows without changing other usages", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: Editor } = await server.ssrLoadModule("/src/components/ui/KeyValueEditor.tsx");
    const rows = Array.from({ length: 7 }, (_, index) => ({ field: "ip", value: `indicator-${index}` }));
    const render = (compact, items = rows) => renderToStaticMarkup(React.createElement(Editor, { title: "IoCs", rows: items, compact, onChange: async () => {} }));
    assert.match(render(true), /indicator-4/);
    assert.doesNotMatch(render(true), /indicator-5/);
    assert.match(render(true), /Show all IoCs \(7\)/);
    assert.match(render(false), /indicator-6/);
    assert.doesNotMatch(render(false), /Show all/);
    assert.doesNotMatch(render(true, rows.slice(0, 5)), /Show all/);
    assert.match(render(true, []), /Empty/);
  } finally { await server.close(); }
});

test("description remains in edit mode on failure and closes only on success", async () => {
  const source = readFileSync(new URL("../src/pages/AlertDetail.tsx", import.meta.url), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  let handler;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "FunctionDeclaration" && node.id?.name === "saveDescriptionFromEditor") handler = source.slice(node.start, node.end);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(ast);
  for (const success of [false, true]) {
    const changes = [];
    const context = { editDescription: "draft", alertDescFocusedRef: { current: true }, saveDescriptionIfDirty: async () => success, setDescriptionActionsVisible: value => changes.push(value) };
    runInNewContext(stripTypeScriptTypes(handler), context);
    await context.saveDescriptionFromEditor();
    assert.deepEqual(changes, success ? [false] : []);
    assert.equal(context.alertDescFocusedRef.current, !success);
  }
});
