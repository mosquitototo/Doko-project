import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import { parse } from "@babel/parser";

for (const page of ["Alerts", "Cases"]) {
  const source = readFileSync(new URL(`../src/pages/${page}.tsx`, import.meta.url), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  let openSource;
  let saveSource;
  let clearSource;
  let scopeSource;
  let rangeSource;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "FunctionDeclaration" && node.id?.name === "openEdit") openSource = source.slice(node.start, node.end);
    if (node.type === "VariableDeclarator" && node.id?.name === "clearFilters") clearSource = source.slice(node.init.start, node.init.end);
    if (node.type === "VariableDeclarator" && node.id?.name === "validCreatedRange") rangeSource = source.slice(node.init.start, node.init.end);
    if (node.type === "VariableDeclarator" && node.id?.name === (page === "Alerts" ? "alertScopeParams" : "caseQueryParams")) scopeSource = source.slice(node.init.arguments[0].start, node.init.arguments[0].end);
    if (node.type === "JSXAttribute" && node.name?.name === "onConfirm" && node.value?.expression) {
      const handler = source.slice(node.value.expression.start, node.value.expression.end);
      if (handler.includes("const ids = editUI.ids")) saveSource = handler;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(ast);
  test(`${page} creation range only applies complete valid dates`, () => {
    for (const [from, to, expected] of [
      ["2026-09-22", "2026-09-23", true],
      ["2026-09-22", "2026-09-22", true],
      ["2026-09-23", "2026-09-22", false],
      ["2026-09-22", "", false],
      ["", "", false],
    ]) {
      const context = { createdFrom: from, createdTo: to, search: "", customer: [], status: [], owner: [], severity: [], classification: [], outcome: [], page: 1, pageSize: 20, ordering: "-created_at", includeArchived: false };
      const result = runInNewContext(`const validCreatedRange = ${rangeSource}; (${scopeSource})();`, context);
      assert.equal(result.created_from, expected ? from : undefined);
      assert.equal(result.created_to, expected ? to : undefined);
    }
  });
  test(`${page} clear filters clears creation dates and resets pagination`, () => {
    const values = {};
    const context = {};
    for (const key of ["CreatedFrom", "CreatedTo", "Page", "Status", "Owner", "Severity", "Classification", "Customer", "Outcome", "SearchInput", "Search", "IncludeArchived"]) context[`set${key}`] = value => { values[key] = value; };
    runInNewContext(`(${clearSource})();`, context);
    assert.equal(values.CreatedFrom, "");
    assert.equal(values.CreatedTo, "");
    assert.equal(values.Page, 1);
    if (page === "Cases") assert.equal(values.IncludeArchived, false);
  });
  for (const mixed of [false, true]) {
    test(`${page} edit prefills shared values and leaves differing fields unchanged (${mixed})`, () => {
      const values = {};
      const rows = [
        { id: "a", customer: "customer-a", severity: "high", classification: "malware", owner_id: 7, status: "open", outcome: "unknown" },
        { id: "b", customer: "customer-a", severity: mixed ? "low" : "high", classification: "malware", owner_id: 7, status: "open", outcome: "unknown" },
      ];
      if (page === "Cases") for (const row of rows) { row.owner_id_read = row.owner_id; delete row.owner_id; }
      const context = { items: rows, itemsArr: rows, editInitial: { current: {} }, setEditUI: () => {} };
      for (const key of ["Customer", "Severity", "Classification", "OwnerId", "Status", "Outcome"]) context[`setEdit${key}`] = value => { values[key] = value; };
      runInNewContext(stripTypeScriptTypes(openSource), context);
      context.openEdit(["a", "b"]);
      assert.equal(values.Customer, "customer-a");
      assert.equal(values.Severity, mixed ? "" : "high");
      assert.equal(values.OwnerId, "7");
    });
  }
  for (const changed of [false, true]) {
    test(`${page} save only sends fields changed after prefilling (${changed})`, async () => {
      const writes = [];
      const context = {
        editUI: { ids: ["a", "b"] }, busyAction: false, busyBulkAction: false, canUpdate: true,
        editCustomer: "customer-a", editSeverity: changed ? "low" : "high", editClassification: "malware", editOwnerId: "7", editStatus: "open", editOutcome: "unknown",
        editInitial: { current: { customer: "customer-a", severity: "high", classification: "malware", owner: "7", owner_id: "7", status: "open", outcome: "unknown" } },
        push: () => {}, setEditUI: () => {}, setSelected: () => {}, setBusyAction: () => {}, setBusyBulkAction: () => {},
        refreshAlertsPage: async () => {}, refreshCasesPage: async () => {},
        updateAlert: async (id, payload) => writes.push([id, JSON.parse(JSON.stringify(payload))]),
        updateTicket: async (id, payload) => writes.push([id, JSON.parse(JSON.stringify(payload))]),
      };
      const save = runInNewContext(stripTypeScriptTypes(`(${saveSource})`), context);
      await save();
      assert.deepEqual(writes, changed ? [["a", { severity: "low" }], ["b", { severity: "low" }]] : []);
    });
  }
}
