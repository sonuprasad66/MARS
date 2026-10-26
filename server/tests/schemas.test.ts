import { describe, expect, it } from "vitest";
import { orderSchema } from "../src/schemas.js";

const base = {
  channel: "NYKAA",
  external_order_id: "NYK-ORDER-1",
  items: [{ sku: "MRS-LIP-104", qty: 2, unit_price: 349 }],
  total_amount: 698
};

describe("order schema", () => {
  it("accepts normalized order events", () => {
    expect(orderSchema.parse(base).items).toHaveLength(1);
  });

  it("rejects duplicate SKUs so line reservations are unambiguous", () => {
    expect(() => orderSchema.parse({
      ...base,
      items: [...base.items, { sku: "MRS-LIP-104", qty: 1, unit_price: 349 }]
    })).toThrow(/each SKU only once/i);
  });

  it("allows cancellation webhook without replaying order lines", () => {
    expect(orderSchema.parse({ channel: "BLINKIT", external_order_id: "B-1", event: "ORDER_CANCELLED" }).items).toBeUndefined();
  });

  it("requires at least one line for order creation", () => {
    expect(() => orderSchema.parse({ channel: "WEBSITE", external_order_id: "W-1" })).toThrow(/at least one item/i);
  });
});
