import { prisma } from "../db.js";

export async function deliverToMockErp(orderId: string) {
  await prisma.outboxEvent.createMany({
    data: [{
      eventType: "MOCK_ERP_DELIVERED",
      aggregateId: orderId,
      payload: { orderId, adapter: "mock" }
    }],
    skipDuplicates: true
  });
}
