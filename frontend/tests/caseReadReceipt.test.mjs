import test from "node:test";
import assert from "node:assert/strict";
import { caseActivityVersion, createCaseReadReceipt } from "../src/utils/caseReadReceipt.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
const cursor = "2026-09-05T10:00:00Z";

test("activity arriving during loading remains eligible for the next read receipt", () => {
  const comments = [{ id: "new", created_at: "2026-09-05T10:00:01Z" }];
  assert.equal(caseActivityVersion(cursor, comments, []), "|");
  assert.equal(caseActivityVersion("2026-09-05T10:00:02Z", comments, []), "new|");
});

test("sub-millisecond activity is not prematurely included in the read version", () => {
  const comments = [{ id: "new", created_at: "2026-09-05T10:00:00.123789Z" }];
  assert.equal(caseActivityVersion("2026-09-05T10:00:00.123456Z", comments, []), "|");
  assert.equal(caseActivityVersion("2026-09-05T10:00:00.124000Z", comments, []), "new|");
});

test("new loaded activity is sent after an in-flight receipt completes", async () => {
  let finish;
  const sent = [];
  const tracker = createCaseReadReceipt({
    send: value => { sent.push(value); return new Promise(resolve => { finish = resolve; }); },
    onError: assert.fail,
  });
  tracker.loaded(cursor, "first");
  tracker.loaded("2026-09-05T10:01:00Z", "second");
  assert.equal(sent.length, 1);
  finish();
  await tick();
  assert.deepEqual(sent, [cursor, "2026-09-05T10:01:00Z"]);
  finish();
  await tick();
  tracker.dispose();
});

test("read receipt retries the same loading cursor and reports persistent failure", async () => {
  const sent = [];
  const scheduled = [];
  let errors = 0;
  const tracker = createCaseReadReceipt({
    send: async value => { sent.push(value); throw new Error("offline"); },
    onError: () => { errors += 1; },
    schedule: callback => { scheduled.push(callback); return scheduled.length; },
  });
  tracker.loaded(cursor, "comment-1");
  await tick();
  scheduled.shift()();
  await tick();
  scheduled.shift()();
  await tick();
  assert.deepEqual(sent, [cursor, cursor, cursor]);
  assert.equal(errors, 1);
  assert.equal(scheduled.length, 0);
});

test("unchanged loaded activity does not send duplicate receipts", async () => {
  const sent = [];
  const tracker = createCaseReadReceipt({ send: async value => { sent.push(value); }, onError: assert.fail });
  tracker.loaded(cursor, "comment-1");
  await tick();
  tracker.loaded("2026-09-05T10:01:00Z", "comment-1");
  await tick();
  assert.deepEqual(sent, [cursor]);
  tracker.loaded("2026-09-05T10:02:00Z", "comment-2");
  await tick();
  assert.equal(sent.length, 2);
});

test("leaving the case cancels retries without notifying or marking another case", async () => {
  let retry;
  let attempts = 0;
  let cancelled;
  const tracker = createCaseReadReceipt({
    send: async () => { attempts += 1; throw new Error("offline"); },
    onError: assert.fail,
    schedule: callback => { retry = callback; return 42; },
    cancel: timer => { cancelled = timer; },
  });
  tracker.loaded(cursor, "comment-1");
  await tick();
  tracker.dispose();
  retry();
  tracker.loaded(cursor, "comment-2");
  await tick();
  assert.equal(cancelled, 42);
  assert.equal(attempts, 1);
});
