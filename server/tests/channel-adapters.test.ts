import { describe, expect, it } from "vitest";
import { prepareMockStockUpdate } from "../src/adapters/channels.js";

describe("mock channel adapter", () => {
  it("surfaces a retryable Blinkit timeout and recovers on the next attempt", async () => {
    for (let call = 0; call < 49; call += 1) await prepareMockStockUpdate("BLINKIT");
    await expect(prepareMockStockUpdate("BLINKIT")).rejects.toThrow("Mock Blinkit timeout");
    await expect(prepareMockStockUpdate("BLINKIT")).resolves.toBeUndefined();
  });
});
