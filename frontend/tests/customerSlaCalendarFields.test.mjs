import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { customerSlaCalendar } from "../src/utils/customerSlaCalendar.ts";

test("invalid calendar drafts remain editable after disabling working-time SLA", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: Fields } = await server.ssrLoadModule("/src/components/settings/CustomerSlaCalendarFields.tsx");
    const render = (value) => renderToStaticMarkup(React.createElement(Fields, { value, onChange() {} }));
    assert.doesNotMatch(render(customerSlaCalendar()), /type="date"/);
    const invalid = customerSlaCalendar({ enabled: false, holidays: [{ date: "", annual: false, label: "" }] });
    assert.match(render(invalid), /type="date"/);
    assert.match(render(invalid), /Remove holiday/);
  } finally {
    await server.close();
  }
});
