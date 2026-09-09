import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("list avatars retain owner labels without visible names and provide an empty fallback", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: Avatar } = await server.ssrLoadModule("/src/components/ui/UserAvatar.tsx");
    const render = (props) => renderToStaticMarkup(React.createElement(Avatar, props));
    const picture = render({ src: "/media/avatars/example.png", name: "Owner" });
    assert.match(picture, /src="\/media\/avatars\/example.png"/);
    assert.match(picture, /title="Owner"/);
    assert.doesNotMatch(picture, />Owner</);
    assert.match(picture, /h-7 w-7/);
    const empty = render({ name: "Owner", size: "sidebar" });
    assert.doesNotMatch(empty, /<img/);
    assert.doesNotMatch(empty, /<svg/);
    assert.match(empty, /border-black/);
    assert.match(empty, /bg-background/);
    assert.match(empty, /h-10 w-10 lg:h-11 lg:w-11/);
    assert.match(render({}), /title="Unassigned"/);
    assert.match(render({}), /<svg/);
    assert.doesNotMatch(picture, /<svg/);
  } finally {
    await server.close();
  }
});
