import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("interface media URLs follow HTTPS without rewriting other resources or deployments", async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const media = await server.ssrLoadModule("/src/utils/mediaUrl.ts");
    assert.equal(typeof media.resolveMediaUrl, "function");
    const resolve = media.resolveMediaUrl;
    for (const path of ["/media/avatars/a.png", "/media/attachments/case/file.pdf", "/media/reports/case/report.pdf"]) {
      assert.equal(resolve(`http://doko.test${path}`, "https://doko.test", ""), `https://doko.test${path}`);
      assert.equal(resolve(`http://doko.test${path}`, "http://doko.test", ""), `http://doko.test${path}`);
      assert.equal(resolve(path, "https://doko.test", ""), path);
      assert.equal(resolve(`https://doko.test${path}`, "https://doko.test", ""), `https://doko.test${path}`);
    }
    assert.equal(resolve("http://doko.test:8443/media/avatars/a%20b.png?v=2#image", "https://doko.test:8443", ""), "https://doko.test:8443/media/avatars/a%20b.png?v=2#image");
    assert.equal(resolve("http://api.test/media/avatars/a.png", "https://ui.test", "https://api.test"), "https://api.test/media/avatars/a.png");
    assert.equal(resolve("/media/avatars/a.png", "https://ui.test", "https://api.test"), "https://api.test/media/avatars/a.png");
    for (const url of [
      "http://external.test/media/avatars/a.png",
      "http://doko.test:8000/media/avatars/a.png",
      "http://doko.test/api/llm/",
      "http://doko.test/media/other/a.png",
      "http://user:password@doko.test/media/avatars/a.png",
      "data:image/png;base64,abc",
      "blob:https://doko.test/avatar",
      "http://[invalid",
      "",
    ]) {
      assert.equal(resolve(url, "https://doko.test", ""), url);
    }
    assert.equal(resolve("http://localhost:8000/media/avatars/a.png", "http://localhost:5173", ""), "http://localhost:8000/media/avatars/a.png");
    assert.equal(resolve("http://api.test/media/avatars/a.png", "https://ui.test", "http://api.test"), "http://api.test/media/avatars/a.png");
    assert.equal(resolve("https://doko.test/media/avatars/a.png", "http://doko.test", ""), "https://doko.test/media/avatars/a.png");
    const { default: Avatar } = await server.ssrLoadModule("/src/components/ui/UserAvatar.tsx");
    const previousWindow = globalThis.window;
    try {
      globalThis.window = { location: { origin: "https://doko.test" } };
      const markup = renderToStaticMarkup(React.createElement(Avatar, { src: "http://doko.test/media/avatars/a.png", name: "Owner" }));
      assert.match(markup, /src="https:\/\/doko.test\/media\/avatars\/a.png"/);
      assert.match(markup, /title="Owner"/);
      assert.match(markup, /h-7 w-7/);
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  } finally {
    await server.close();
  }
});
