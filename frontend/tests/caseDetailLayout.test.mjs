import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";

function handler(name) {
  const source = readFileSync(new URL("../src/components/cases/detail/CaseSummaryTab.tsx", import.meta.url), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  let result;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "FunctionDeclaration" && node.id?.name === name) result = source.slice(node.start, node.end);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(ast);
  assert.ok(result, `${name} is available`);
  return stripTypeScriptTypes(result);
}

test("case description editor closes only after a successful save", async () => {
  for (const success of [false, true]) {
    const changes = [];
    const context = { props: { editDescription: "draft", saveIfDirty: async () => success }, setDescriptionEditing: value => changes.push(value) };
    runInNewContext(handler("saveDescription"), context);
    await context.saveDescription();
    assert.deepEqual(changes, success ? [false] : []);
  }
});

test("case note editor stays open on failed publication", async () => {
  for (const success of [false, true]) {
    const changes = [];
    const context = { props: { submitComment: async () => success }, setNoteEditorOpen: value => changes.push(value) };
    runInNewContext(handler("publishNote"), context);
    await context.publishNote();
    assert.deepEqual(changes, success ? [false] : []);
  }
});
