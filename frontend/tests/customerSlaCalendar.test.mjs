import test from "node:test";
import assert from "node:assert/strict";
import { customerSlaCalendar, calendarError } from "../src/utils/customerSlaCalendar.ts";

test("customer calendar defaults preserve elapsed mode and use independent working days", () => {
  const first = customerSlaCalendar();
  assert.equal(first.enabled, false);
  assert.deepEqual(first.weekdays, [0, 1, 2, 3, 4]);
  assert.equal(first.month_days, 20);
  first.weekdays.push(5);
  first.holidays.push({ date: "2026-07-14", annual: true, label: "Holiday" });
  const second = customerSlaCalendar();
  assert.equal(second.weekdays.length, 5);
  assert.equal(second.holidays.length, 0);
});

test("calendar roundtrip retains every customer-specific field", () => {
  const stored = {
    enabled: true, timezone: "Asia/Tokyo", weekdays: [0, 1, 2, 3, 4, 5],
    work_start: "09:00", work_end: "16:00", month_days: 26,
    holidays: [{ date: "2026-05-01", annual: true, label: "Contract holiday" }],
  };
  assert.deepEqual(customerSlaCalendar(stored), stored);
  const copy = customerSlaCalendar(stored);
  copy.holidays[0].label = "Changed";
  assert.equal(stored.holidays[0].label, "Contract holiday");
});

test("invalid calendar entries prevent submission without blocking valid all-day coverage", () => {
  const value = customerSlaCalendar({ enabled: true });
  assert.equal(calendarError(value), null);
  for (const patch of [{ weekdays: [] }, { month_days: 0 }, { work_end: "08:00" }, { work_end: "99:00" }, { holidays: [{ date: "2026-02-30", annual: false, label: "" }] }]) {
    assert.equal(typeof calendarError({ ...value, ...patch }), "string");
  }
  assert.equal(calendarError({ ...value, work_start: "00:00", work_end: "24:00", weekdays: [0, 1, 2, 3, 4, 5, 6] }), null);
});
