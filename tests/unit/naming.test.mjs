import assert from "node:assert/strict";
import test from "node:test";

import naming from "../../dist/utils/naming.js";

const { resolveExistingModuleNaming, resolveModuleNaming } = naming;

const cases = [
  {
    inputs: ["order", "orders"],
    expected: {
      name: "order",
      pkg: "order",
      pascalName: "Order",
      plural: "orders",
      tableName: "orders",
      errorPrefix: "ORDER",
    },
  },
  {
    inputs: ["category", "categories"],
    expected: {
      name: "category",
      pkg: "category",
      pascalName: "Category",
      plural: "categories",
      tableName: "categories",
      errorPrefix: "CATEGORY",
    },
  },
  {
    inputs: ["status", "statuses"],
    expected: {
      name: "status",
      pkg: "status",
      pascalName: "Status",
      plural: "statuses",
      tableName: "statuses",
      errorPrefix: "STATUS",
    },
  },
  {
    inputs: ["order-item", "order-items"],
    expected: {
      name: "order-item",
      pkg: "orderitem",
      pascalName: "OrderItem",
      plural: "order-items",
      tableName: "order_items",
      errorPrefix: "ORDER_ITEM",
    },
  },
];

for (const { inputs, expected } of cases) {
  for (const input of inputs) {
    test(`resolveModuleNaming normalizes ${input}`, () => {
      assert.deepEqual(resolveModuleNaming(input), expected);
    });
  }
}

test("resolveExistingModuleNaming finds a pre-canonical plural package", () => {
  const expected = {
    name: "orders",
    pkg: "orders",
    pascalName: "Orders",
    plural: "orderses",
    tableName: "orderses",
    errorPrefix: "ORDERS",
  };
  assert.deepEqual(resolveExistingModuleNaming("orders", ["orders"]), expected);
  assert.deepEqual(resolveExistingModuleNaming("order", ["orders"]), expected);
});

test("resolveExistingModuleNaming can locate a legacy package whose singular is now reserved", () => {
  assert.deepEqual(resolveExistingModuleNaming("types", ["types"]), {
    name: "types",
    pkg: "types",
    pascalName: "Types",
    plural: "typeses",
    tableName: "typeses",
    errorPrefix: "TYPES",
  });
});

test("resolveExistingModuleNaming rejects canonical and legacy packages together", () => {
  for (const input of ["order", "orders"]) {
    assert.throws(
      () => resolveExistingModuleNaming(input, ["order", "orders"]),
      /ambiguous module.*internal\/app\/order.*internal\/app\/orders/
    );
  }
});
