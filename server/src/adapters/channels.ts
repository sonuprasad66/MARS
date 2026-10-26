import { Channel, Prisma } from "@prisma/client";

const recentRequests = new Map<Channel, number[]>();
let blinkitMockCalls = 0;

export async function prepareMockStockUpdate(channel: Channel) {
  const limit = channel === "NYKAA" ? 5 : channel === "FLIPKART" ? 10 : Infinity;
  if (Number.isFinite(limit)) {
    while (true) {
      const now = Date.now();
      const timestamps = (recentRequests.get(channel) ?? []).filter((timestamp) => now - timestamp < 1000);
      if (timestamps.length < limit) {
        timestamps.push(now);
        recentRequests.set(channel, timestamps);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, 1000 - (now - timestamps[0]!))));
    }
  }

  if (channel === "BLINKIT") {
    blinkitMockCalls += 1;
    if (blinkitMockCalls % 50 === 0) throw new Error("Mock Blinkit timeout");
  }
}

export async function publishMockStock(tx: Prisma.TransactionClient, channel: Channel, productId: string, quantity: number) {
  const result = await tx.channelListing.updateMany({
    where: { productId, channel },
    data: { lastSyncedQty: quantity, lastSyncedAt: new Date() }
  });
  if (result.count !== 1) throw new Error(`No ${channel} listing exists for product ${productId}`);
}
