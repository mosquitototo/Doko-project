import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("dedicated Catbot has conversation navigation and a compact composer without redundant labels", async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.sessionStorage;
  try {
    globalThis.sessionStorage = { getItem: () => "test-tab", setItem: () => {} };
    const { default: Page } = await server.ssrLoadModule("/src/pages/Chatbot.tsx");
    const { MeContext } = await server.ssrLoadModule("/src/contexts/MeContext.tsx");
    const { ToastProvider } = await server.ssrLoadModule("/src/components/ui/toast.tsx");
    const markup = renderToStaticMarkup(React.createElement(MeContext.Provider, { value: { me: { id: 1, is_admin: true }, reloadMe: async () => {} } }, React.createElement(ToastProvider, null, React.createElement(Page))));
    assert.match(markup, /New conversation/);
    assert.match(markup, /rows="2"/);
    assert.doesNotMatch(markup, />Prompt</);
    assert.doesNotMatch(markup, />Conversation</);
    assert.doesNotMatch(markup, /min-h-\[600px\]/);
    assert.match(markup, /aria-label="Message"/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousStorage === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previousStorage;
    await server.close();
  }
});
