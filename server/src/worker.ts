import { JobKind, JobStatus } from "@prisma/client";
import { env } from "./config/env.js";
import { prisma } from "./db.js";
import { logger } from "./logger.js";
import { prepareMockStockUpdate, publishMockStock } from "./adapters/channels.js";
import { deliverToMockErp } from "./adapters/erp.js";

const MAX_ATTEMPTS = 8;
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function processJob(id: string) {
  const claimed = await prisma.syncJob.updateMany({
    where: { id, status: JobStatus.PENDING, nextAttemptAt: { lte: new Date() } },
    data: { status: JobStatus.PROCESSING, attempts: { increment: 1 } }
  });
  if (claimed.count !== 1) return;
  const job = await prisma.syncJob.findUniqueOrThrow({ where: { id } });
  try {
    if (job.kind === JobKind.STOCK_SYNC && job.productId && job.channel) {
      await prepareMockStockUpdate(job.channel);
      await prisma.$transaction(async (tx) => {
        const inventoryRows = await tx.$queryRaw<Array<{ version: number; onHand: number; reserved: number }>>`
          SELECT "version", "onHand", "reserved" FROM "Inventory"
          WHERE "productId" = ${job.productId}
          FOR UPDATE
        `;
        const inventory = inventoryRows[0];
        if (!inventory) throw new Error("Inventory row missing for stock sync");
        if ((job.inventoryVersion ?? 0) < inventory.version) {
          await tx.syncJob.update({ where: { id }, data: { status: JobStatus.SUCCEEDED, lastError: "Superseded by a newer stock version" } });
          return;
        }
        await publishMockStock(tx, job.channel!, job.productId!, inventory.onHand - inventory.reserved);
        await tx.syncJob.update({ where: { id }, data: { status: JobStatus.SUCCEEDED, lastError: null } });
      });
      return;
    } else if (job.kind === JobKind.ERP_DELIVERY) {
      if (!job.orderId) throw new Error("ERP job has no order");
      // The local ERP adapter stores an idempotent delivery marker in the transactional database.
      await deliverToMockErp(job.orderId);
    } else {
      throw new Error("Unsupported job configuration");
    }
    await prisma.syncJob.update({ where: { id }, data: { status: JobStatus.SUCCEEDED, lastError: null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error";
    const attempts = job.attempts;
    const failed = attempts >= MAX_ATTEMPTS;
    await prisma.syncJob.update({
      where: { id },
      data: {
        status: failed ? JobStatus.FAILED : JobStatus.PENDING,
        lastError: message,
        nextAttemptAt: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** attempts))
      }
    });
  }
}

async function run() {
  logger.info("Mock integration worker started");
  while (true) {
    try {
      const jobs = await prisma.syncJob.findMany({
        where: { status: JobStatus.PENDING, nextAttemptAt: { lte: new Date() } },
        orderBy: { createdAt: "asc" },
        take: 10
      });
      for (const job of jobs) await processJob(job.id);
    } catch (error) {
      logger.error({ err: error }, "Worker poll failed");
    }
    await sleep(env.WORKER_POLL_INTERVAL_MS);
  }
}

void run().catch(async (error) => {
  logger.fatal({ err: error }, "Worker stopped unexpectedly");
  await prisma.$disconnect();
  process.exit(1);
});

process.on("SIGINT", () => void prisma.$disconnect().finally(() => process.exit(0)));
process.on("SIGTERM", () => void prisma.$disconnect().finally(() => process.exit(0)));
