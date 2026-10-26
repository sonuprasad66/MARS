import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const products = [
  { sku: "MRS-LIP-104", name: "Velvet Matte Lipstick", unitPrice: "349.00", onHand: 120 },
  { sku: "MRS-KJL-011", name: "Precision Kajal", unitPrice: "199.00", onHand: 80 },
  { sku: "MRS-SER-205", name: "Vitamin C Face Serum", unitPrice: "799.00", onHand: 45 },
  { sku: "MRS-CRM-070", name: "Daily Hydration Cream", unitPrice: "599.00", onHand: 60 },
  { sku: "MRS-MSK-033", name: "Volume Boost Mascara", unitPrice: "449.00", onHand: 3 }
];
const channels = ["WEBSITE", "NYKAA", "FLIPKART", "BLINKIT"] as const;

async function main() {
  for (const item of products) {
    const product = await prisma.product.upsert({
      where: { sku: item.sku },
      update: { name: item.name, unitPrice: item.unitPrice },
      create: { sku: item.sku, name: item.name, unitPrice: item.unitPrice }
    });
    await prisma.inventory.upsert({
      where: { productId: product.id },
      update: {},
      create: { productId: product.id, onHand: item.onHand, reserved: 0 }
    });
    for (const channel of channels) {
      await prisma.channelListing.upsert({
        where: { productId_channel: { productId: product.id, channel } },
        update: {},
        create: { productId: product.id, channel, externalSku: item.sku, lastSyncedQty: item.onHand }
      });
    }
  }

  const demo = await prisma.order.findUnique({
    where: { channel_externalOrderId: { channel: "WEBSITE", externalOrderId: "DEMO-WEB-1001" } }
  });
  if (!demo) {
    await prisma.$transaction(async (tx) => {
      const item = await tx.product.findUniqueOrThrow({ where: { sku: "MRS-LIP-104" } });
      const order = await tx.order.create({
        data: {
          channel: "WEBSITE",
          externalOrderId: "DEMO-WEB-1001",
          status: "CONFIRMED",
          eventTime: new Date(),
          paymentMode: "PREPAID",
          totalAmount: "698.00",
          lines: { create: [{ productId: item.id, quantity: 2, unitPrice: "349.00" }] }
        }
      });
      const inventory = await tx.inventory.update({
        where: { productId: item.id },
        data: { reserved: { increment: 2 }, version: { increment: 1 } }
      });
      await tx.reservation.create({ data: { orderId: order.id, productId: item.id, quantity: 2 } });
      await tx.inventoryAudit.create({
        data: { productId: item.id, orderId: order.id, reason: "ORDER_RESERVATION", deltaOnHand: 0, deltaReserved: 2 }
      });
      for (const channel of channels) {
        await tx.syncJob.create({
          data: { kind: "STOCK_SYNC", channel, productId: item.id, desiredQty: inventory.onHand - inventory.reserved, inventoryVersion: inventory.version }
        });
      }
      await tx.syncJob.create({ data: { kind: "ERP_DELIVERY", orderId: order.id } });
      await tx.outboxEvent.create({
        data: { eventType: "ORDER_CONFIRMED", aggregateId: order.id, payload: { orderId: order.id, externalOrderId: order.externalOrderId } }
      });
    });
  }

  const failedJob = await prisma.syncJob.findFirst({ where: { status: "FAILED", lastError: "Seeded mock timeout for retry demo" } });
  if (!failedJob) {
    const product = await prisma.product.findUniqueOrThrow({ where: { sku: "MRS-SER-205" } });
    await prisma.syncJob.create({
      data: {
        kind: "STOCK_SYNC",
        channel: "BLINKIT",
        productId: product.id,
        desiredQty: 45,
        status: "FAILED",
        attempts: 3,
        lastError: "Seeded mock timeout for retry demo"
      }
    });
  }
  console.info("Seed complete: 5 products, 4 channel listings each, and demo sync data.");
}

main().finally(async () => prisma.$disconnect());
