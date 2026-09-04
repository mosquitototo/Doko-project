import assert from "node:assert/strict";
import test from "node:test";

import { pageAfterDeletion } from "../src/utils/pagination.ts";

test("moves to the preceding page when deletion removes the last page", () => {
  assert.equal(
    pageAfterDeletion({
      currentPage: 2,
      totalCount: 21,
      deletedCount: 1,
      pageSize: 20,
    }),
    1,
  );
});

test("keeps the current page when it remains valid", () => {
  assert.equal(
    pageAfterDeletion({
      currentPage: 2,
      totalCount: 22,
      deletedCount: 1,
      pageSize: 20,
    }),
    2,
  );
});
