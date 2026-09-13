import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { parse } from "@babel/parser";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

function functionsFrom(path, names) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const found = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "FunctionDeclaration" && names.includes(node.id?.name)) {
      found.push(source.slice(node.start, node.end));
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(ast);
  assert.equal(found.length, names.length);
  return found.join("\n");
}

const code = stripTypeScriptTypes([
  functionsFrom("../src/pages/CaseDetail.tsx", ["onSendExchange", "onCreateExchange", "saveReplyDraftToConversationOnly", "closeReplyModal", "openReplyModal", "buildReferencesForReply"]),
  functionsFrom("../src/components/cases/detail/utils.ts", ["parseCsv", "normalizeSubjectForReply"]),
].join("\n"));

function setup(overrides = {}) {
  const state = {
    canUpdateCase: true, ticketId: "case-1", replyModalOpen: true,
    exchangeCreateOpen: false, replyTarget: { message_id: "parent-1" },
    replyQueue: [], replyQueueIdx: 0, exchangesBusy: false,
    exchangeDraft: { direction: "outbound", channel: "email", sender: "", to: "user@example.com", cc: "", bcc: "", subject: "Reply", body: "Keep this message", message_id: "", references: "parent-1" },
    sent: [], notices: [], refreshes: 0,
    ...overrides,
  };
  for (const key of ["replyModalOpen", "exchangeCreateOpen", "replyTarget", "replyQueue", "replyQueueIdx", "exchangesBusy", "exchangeDraft", "selectedQuickpartId"]) {
    state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = value; };
  }
  state.push = notice => state.notices.push(notice);
  state.refreshQuickparts = async () => {};
  state.refreshExchanges = async () => { state.refreshes++; };
  state.sendCaseExchange ??= async (id, payload) => { state.sent.push({ id, payload }); };
  state.createCaseExchange ??= async (id, payload) => { state.sent.push({ id, payload }); };
  runInNewContext(code, state);
  return state;
}

test("Send closes Reply only after the API succeeds and retains reply metadata", async () => {
  let finish;
  const state = setup({ sendCaseExchange: (id, payload) => {
    state.sent.push({ id, payload });
    return new Promise(resolve => { finish = resolve; });
  } });
  const sending = state.onSendExchange();
  assert.equal(state.replyModalOpen, true);
  assert.equal(state.exchangeDraft.body, "Keep this message");
  finish();
  await sending;
  assert.equal(state.replyModalOpen, false);
  assert.equal(state.replyTarget, null);
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].id, "case-1");
  assert.equal(state.sent[0].payload.raw.in_reply_to, "parent-1");
  assert.equal(state.sent[0].payload.body, "Keep this message");
  assert.equal(state.refreshes, 1);
  assert.equal(state.exchangesBusy, false);
});

for (const action of ["onSendExchange", "saveReplyDraftToConversationOnly", "onCreateExchange"]) {
  test(`${action} preserves the window and draft when the API fails`, async () => {
    const fail = async () => { throw new Error("offline"); };
    const state = setup({ exchangeCreateOpen: true, sendCaseExchange: fail, createCaseExchange: fail });
    await state[action]();
    assert.equal(state.replyModalOpen, true);
    assert.equal(state.exchangeCreateOpen, true);
    assert.equal(state.exchangeDraft.body, "Keep this message");
    assert.equal(state.notices.at(-1).kind, "error");
    assert.equal(state.exchangesBusy, false);
  });
}

test("Save closes Reply after saving without sending an email", async () => {
  const state = setup({ sendCaseExchange: assert.fail });
  await state.saveReplyDraftToConversationOnly();
  assert.equal(state.replyModalOpen, false);
  assert.equal(state.sent.length, 1);
});

for (const action of ["onSendExchange", "onCreateExchange"]) {
  test(`${action} closes the new-message window after success`, async () => {
    const state = setup({ replyModalOpen: false, replyTarget: null, exchangeCreateOpen: true });
    await state[action]();
    assert.equal(state.exchangeCreateOpen, false);
    assert.equal(state.replyModalOpen, false);
  });
}

test("Send advances an existing reply queue without erasing the next reply", async () => {
  const next = { sender: "next@example.com", subject: "Next", message_id: "parent-2", references: [], channel: "email" };
  const state = setup({ replyQueue: [{ message_id: "parent-1" }, next] });
  await state.onSendExchange();
  assert.equal(state.replyQueueIdx, 1);
  assert.equal(state.replyModalOpen, true);
  assert.equal(state.replyTarget, next);
  assert.equal(state.exchangeDraft.to, "next@example.com");
  assert.equal(state.exchangeDraft.subject, "Re: Next");
  assert.equal(state.exchangeDraft.references, "parent-2");
});

test("Exchange bodies and composer retain raw HTML without active markup", async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: Rendered } = await server.ssrLoadModule("/src/components/ui/TiptapRenderedContent.tsx");
    const { default: Editor, insertExchangeHtml } = await server.ssrLoadModule("/src/components/ui/TiptapEditor.tsx");
    const body = '  <html>\n<script>alert(1)</script><img src="https://example.test/image" onerror="alert(2)"><a href="javascript:alert(3)">link</a><hr>\n**literal** &amp;  ';
    for (const component of [React.createElement(Rendered, { html: body }), React.createElement(Editor, { value: body, onChange() {}, disabled: true })]) {
      const html = renderToStaticMarkup(component);
      assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
      assert.ok(html.includes('**literal** &amp;amp;  '));
      assert.doesNotMatch(html, /<(script|img|a|iframe|hr)\b/i);
    }
    const { default: Tab } = await server.ssrLoadModule("/src/components/cases/detail/CaseExchangesTab.tsx");
    for (const direction of ["inbound", "outbound"]) {
      const html = renderToStaticMarkup(React.createElement(Tab, {
        exchanges: [{ id: "message", direction, channel: "email", body: "<hr><br>", created_at: "2026-09-12T12:00:00Z", to: [] }],
        selectedExchangeIds: {},
      }));
      assert.ok(html.includes("&lt;hr&gt;&lt;br&gt;"));
      assert.doesNotMatch(html, /\(empty\)/);
    }
    for (const [opening, closing] of [["<strong>", "</strong>"], ["<em>", "</em>"], ["<br>", ""], ["<hr>", ""]]) {
      const result = insertExchangeHtml("before AFTER", 7, 7, opening, closing);
      assert.equal(result.value, `before ${opening}${closing}AFTER`);
      assert.equal(result.start, 7 + opening.length);
      assert.equal(result.end, result.start);
    }
    const selected = insertExchangeHtml("A <code> B", 2, 8, "<strong>", "</strong>");
    assert.equal(selected.value, "A <strong><code></strong> B");
    assert.equal(selected.value.slice(selected.start, selected.end), "<code>");
  } finally {
    await server.close();
  }
});

test("Exchange shortcut fallback uses textarea offsets for CRLF input", () => {
  let value;
  const state = {
    props: { value: "A\r\nBC", onChange: next => { value = next; } },
    textarea: { current: { value: "A\nBC", selectionStart: 2, selectionEnd: 3, focus() {} } },
    selection: { current: null },
    document: { execCommand: () => false },
  };
  const code = stripTypeScriptTypes(functionsFrom("../src/components/ui/TiptapEditor.tsx", ["insertExchangeHtml", "insert"]));
  runInNewContext(code, state);
  state.insert("<strong>", "</strong>");
  assert.equal(value, "A\n<strong>B</strong>C");
});
