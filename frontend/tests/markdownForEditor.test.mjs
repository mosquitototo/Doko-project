import assert from "node:assert/strict";
import test from "node:test";

import { markdownForMdxEditor } from "../src/components/ui/markdownForEditor.ts";

test("keeps fenced and inline code unchanged", () => {
  const value = "`const value = { raw: '<tag' }`\n\n```html\n<div>{value}</div>\n```";

  assert.equal(markdownForMdxEditor(value), value);
});

test("normalizes supported HTML and escapes malformed MDX as visible text", () => {
  const value = [
    "-------------------- begin ------------------",
    "tototo<br>",
    "https://totopzoe,fdopze,fdpok",
    "Description with an unclosed <tag and { expression",
  ].join("\n");

  assert.equal(
    markdownForMdxEditor(value),
    [
      "-------------------- begin ------------------",
      "tototo",
      "",
      "https://totopzoe,fdopze,fdpok",
      "Description with an unclosed \\<tag and \\{ expression",
    ].join("\n"),
  );
});
