import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import { parse } from "@babel/parser";

const source = readFileSync(new URL("../src/pages/settings/AutomationRuleEdit.tsx", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
let saveSource;
function visit(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "FunctionDeclaration" && node.id?.name === "onSave") saveSource = source.slice(node.start, node.end);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") visit(value);
  }
}
visit(ast);

for (const isNew of [true, false]) {
  for (const failure of [false, true]) {
    test(`${isNew ? "creating" : "editing"} a rule ${failure ? "keeps the editor on API error" : "returns to case management after success"}`, async () => {
      const paths = [];
      const writes = [];
      const context = {
        canSave: true, isNew, id: "rule-1", name: " Rule ", scope: "alert", isEnabled: true,
        conditions: {}, actions: [{ type: "set_status", value: "open" }], runOncePerTarget: false,
        cooldownSeconds: 0, stopOnFirstActionError: true, validateActions: () => null,
        normalizeCooldownSeconds: Number, setSaving: () => {}, push: () => {},
        navigate: path => paths.push(path),
        createAutomationRule: async payload => { if (failure) throw Error("offline"); writes.push(payload); },
        updateAutomationRule: async (id, payload) => { assert.equal(id, "rule-1"); if (failure) throw Error("offline"); writes.push(payload); },
      };
      runInNewContext(stripTypeScriptTypes(saveSource), context);
      await context.onSave();
      assert.deepEqual(paths, failure ? [] : ["/settings/case-management"]);
      assert.equal(writes.length, failure ? 0 : 1);
    });
  }
}
