import assert from "node:assert/strict";
import test from "node:test";
import { selectCustomerScope, toggleCustomerSubgroup, customerSubgroupNames } from "../src/utils/customerScopeSelection.ts";

test("changing customers clears previous subgroups", () => {
  assert.deepEqual(selectCustomerScope("next"), { customer: "next", subgroups: [] });
});

test("removing the customer clears all subgroups", () => {
  assert.deepEqual(selectCustomerScope(null), { customer: null, subgroups: [] });
});

test("a subgroup under another customer selects that customer and just that subgroup", () => {
  assert.deepEqual(toggleCustomerSubgroup({ customer: "current", subgroups: ["old"] }, "next", "new"), {
    customer: "next", subgroups: ["new"],
  });
});

test("toggling a subgroup preserves other selected subgroups", () => {
  assert.deepEqual(toggleCustomerSubgroup({ customer: "current", subgroups: ["one"] }, "current", "two"), {
    customer: "current", subgroups: ["one", "two"],
  });
  assert.deepEqual(toggleCustomerSubgroup({ customer: "current", subgroups: ["one", "two"] }, "current", "one"), {
    customer: "current", subgroups: ["two"],
  });
});

test("removing the last subgroup retains the customer", () => {
  assert.deepEqual(toggleCustomerSubgroup({ customer: "current", subgroups: ["one"] }, "current", "one"), {
    customer: "current", subgroups: [],
  });
});

test("selected subgroup names resolve within the assigned customer", () => {
  const customers = [
    { id: "current", subgroups: [{ id: "one", name: "Paris" }, { id: "two", name: "Lyon" }] },
    { id: "other", subgroups: [{ id: "three", name: "London" }] },
  ];
  assert.deepEqual(customerSubgroupNames(customers, { customer: "current", subgroups: ["two", "one"] }), ["Lyon", "Paris"]);
  assert.deepEqual(customerSubgroupNames(customers, { customer: "current", subgroups: [] }), []);
  assert.deepEqual(customerSubgroupNames(customers, { customer: null, subgroups: ["one"] }), []);
});
