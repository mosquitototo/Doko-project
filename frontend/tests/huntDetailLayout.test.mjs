import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/pages/HuntDetail.tsx", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });

function handler(name) {
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
  assert.ok(result);
  return stripTypeScriptTypes(result);
}

for (const field of ["Context", "Conclusion"]) {
  test(`hunt ${field.toLowerCase()} closes only after successful autosave, preserves failures and permissions`, async () => {
    for (const allowed of [false, true]) {
      for (const succeeds of [false, true]) {
        const edits = [], saves = [], writes = [], errors = [];
        const context = {
          canManageHunt: allowed, hunt: { [field.toLowerCase()]: "old" }, huntId: "hunt",
          [`edit${field}`]: "draft",
          [`set${field}Editing`]: value => edits.push(value),
          [`set${field}Saving`]: value => saves.push(value),
          [`set${field}SavedAt`]: () => {},
          [`setEdit${field}`]: () => {},
          setHunt: () => {}, push: value => errors.push(value),
          updateHunt: async (id, payload) => { writes.push({ id, payload }); if (!succeeds) throw new Error("failure"); },
        };
        runInNewContext(handler(`autosave${field}`), context);
        await context[`autosave${field}`]();
        assert.deepEqual(edits, allowed && succeeds ? [false] : []);
        assert.deepEqual(saves, allowed ? [true, false] : []);
        assert.equal(writes.length, allowed ? 1 : 0);
        if (allowed) assert.equal(writes[0].payload[field.toLowerCase()], "draft");
        assert.equal(errors.length, allowed && !succeeds ? 1 : 0);
      }
    }
  });
}
