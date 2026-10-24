import assert from "node:assert/strict";
import test from "node:test";
import { readListFilters, saveListFilters, clearListFilters } from "../src/utils/listViewSession.ts";

function storage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

test("task filters retain priorities and remain isolated until session cleanup", () => {
  globalThis.sessionStorage = storage();
  const filters = { priority: ["high"], status: ["to_do"], owner: ["1"], customer: ["a"], searchInput: "task", ordering: "title", filtersOpen: true };
  saveListFilters("tasks", 1, filters);
  assert.deepEqual(readListFilters("tasks", 1), filters);
  assert.deepEqual(readListFilters("tasks", 2), {});
  assert.deepEqual(readListFilters("alerts", 1), {});
  clearListFilters();
  assert.deepEqual(readListFilters("tasks", 1), {});
});

test("list filters survive a read while remaining scoped to the user and list", () => {
  globalThis.sessionStorage = storage();
  saveListFilters("alerts", 1, { status: [], searchInput: "needle", createdFrom: "2026-10-01", filtersOpen: true });
  assert.deepEqual(readListFilters("alerts", 1), { status: [], searchInput: "needle", createdFrom: "2026-10-01", filtersOpen: true });
  assert.deepEqual(readListFilters("cases", 1), {});
  assert.deepEqual(readListFilters("alerts", 2), {});
  assert.deepEqual(readListFilters("alerts", undefined), {});
});

test("only valid filter fields are retained, never selections or result contents", () => {
  globalThis.sessionStorage = storage();
  saveListFilters("cases", 1, { status: ["open"], includeArchived: false });
  const key = sessionStorage.key(0);
  sessionStorage.setItem(key, JSON.stringify({ status: "closed", owner: [1], searchInput: 42, filtersOpen: "yes", selected: ["id"], items: [{ description: "secret" }], severity: ["high"] }));
  assert.deepEqual(readListFilters("cases", 1), { severity: ["high"] });
  sessionStorage.setItem(key, "{broken");
  assert.deepEqual(readListFilters("cases", 1), {});
});

test("session cleanup removes list filters without clearing unrelated session data", () => {
  globalThis.sessionStorage = storage();
  sessionStorage.setItem("unrelated", "keep");
  saveListFilters("alerts", 1, { status: ["closed"] });
  saveListFilters("cases", 2, { owner: ["2"] });
  clearListFilters();
  assert.deepEqual(readListFilters("alerts", 1), {});
  assert.deepEqual(readListFilters("cases", 2), {});
  assert.equal(sessionStorage.getItem("unrelated"), "keep");
});

test("unavailable storage does not prevent viewing lists or authentication cleanup", () => {
  globalThis.sessionStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("quota"); },
    get length() { throw new Error("blocked"); },
  };
  assert.deepEqual(readListFilters("alerts", 1), {});
  assert.doesNotThrow(() => saveListFilters("alerts", 1, { searchInput: "test" }));
  assert.doesNotThrow(() => clearListFilters());
});
