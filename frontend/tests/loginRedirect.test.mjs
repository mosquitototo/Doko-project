import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/pages/Login.tsx", import.meta.url), "utf8");
const start = source.indexOf("function safeNextPath(");
const end = source.indexOf("\nexport default", start);
const context = { URL, window: { location: { origin: "https://doko.example.test" } } };
runInNewContext(stripTypeScriptTypes(source.slice(start, end)), context);

test("login keeps local paths with queries and fragments", () => {
  assert.equal(context.safeNextPath("/cases?id=123#exchange"), "/cases?id=123#exchange");
  assert.equal(context.safeNextPath("%2Falerts"), "/alerts");
});

test("login rejects external and control-character navigation", () => {
  for (const value of ["https://outside.test", "//outside.test", "/\\outside.test", "/\t/outside.test", "/\n/outside.test", "/%0d/outside.test", "%2F%09%2Foutside.test", "%"]) {
    assert.equal(context.safeNextPath(value), "/", JSON.stringify(value));
  }
});
