import assert from "node:assert/strict";
import test from "node:test";

import naming from "../../dist/utils/naming.js";

const { resolveModuleNaming } = naming;

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
