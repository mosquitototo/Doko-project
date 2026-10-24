import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

test("severity chart colors cover the badge palette with a gray fallback", async () => {
  const colors = await import("../src/components/ui/severityColors.ts");
  assert.equal(typeof colors.severityChartColor, "function");
  assert.equal(colors.severityChartColor("violet"), "#8b5cf6");
  assert.equal(colors.severityChartColor("emerald"), "#10b981");
  for (const color of Object.keys(colors.severityColors)) {
    assert.match(colors.severityChartColor(color), /^#[0-9a-f]{6}$/);
  }
  assert.equal(colors.severityChartColor("invalid"), colors.severityChartColor("gray"));
});

test("data model lists load every page and retain include-inactive filtering", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { api } = await server.ssrLoadModule("/src/api/client.ts");
    const models = await server.ssrLoadModule("/src/api/dataModels.ts");
    api.defaults.adapter = async config => {
      const page = config.params?.page || 1;
      assert.equal(config.params.include_inactive, "1");
      return { status: 200, statusText: "OK", headers: {}, config, data: {
        count: 41, next: page < 3 ? `http://internal/api/?page=${page + 1}` : null,
        results: Array.from({ length: page === 3 ? 1 : 20 }, (_, i) => ({ id: (page - 1) * 20 + i + 1 })),
      } };
    };
    for (const list of [models.listClassifications, models.listSeverities]) {
      const items = await list(true);
      assert.equal(items.length, 41);
      assert.equal(items[40].id, 41);
    }
  } finally { await server.close(); }
});

test("catalog retains colors of inactive severities without making them selectable", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { api } = await server.ssrLoadModule("/src/api/client.ts");
    let color = "violet";
    api.defaults.adapter = async config => ({ status: 200, statusText: "OK", headers: {}, config, data:
      config.url.includes("severities") ? [
        { id: 1, code: "high", label: "High", order: 1, is_active: true, color },
        ...(config.params.include_inactive === "1" ? [{ id: 2, code: "old", label: "Old", order: 2, is_active: false, color: "blue" }] : []),
      ] : [] });
    const { getCatalog, clearCatalogCache } = await server.ssrLoadModule("/src/data/catalog.ts");
    const catalog = await getCatalog();
    assert.deepEqual(catalog.severities.map(x => x.code), ["high"]);
    assert.equal(catalog.severityColorsByCode?.high, "violet");
    assert.equal(catalog.severityColorsByCode?.old, "blue");
    color = "red";
    clearCatalogCache();
    assert.equal((await getCatalog()).severityColorsByCode.high, "red");
  } finally { await server.close(); }
});
