import { Channel, JobKind, JobStatus, OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { orderSchema } from "../schemas.js";

type Transaction = Prisma.TransactionClient;

async function queueStockSync(tx: Transaction, productId: string, version: number, desiredQty: number) {
  const listings = await tx.channelListing.findMany({ where: { productId }, select: { channel: true } });
  for (const listing of listings) {
    await tx.syncJob.create({
      data: { kind: JobKind.STOCK_SYNC, channel: listing.channel, productId, inventoryVersion: version, desiredQty }
    });
  }
}

export async function ingestOrder(raw: unknown) {
  const input = orderSchema.parse(raw);
  if (input.event !== "ORDER_CREATED" || !input.items?.length) {
    throw new AppError("Order creation requires at least one item", 400, "INVALID_ORDER_EVENT");
  }
  const items = input.items;
  const eventTime = input.event_time ? new Date(input.event_time) : new Date();
  const totalAmount = input.total_amount ?? items.reduce((sum, item) => sum + item.qty * Math.round(item.unit_price * 100), 0) / 100;

  const prior = await prisma.order.findUnique({
    where: { channel_externalOrderId: { channel: input.channel as Channel, externalOrderId: input.external_order_id } },
    include: { lines: true }
  });
  if (prior) return { order: prior, duplicate: true };

  try {
    const order = await prisma.$transaction(async (tx) => {
      const records = await Promise.all(items.map(async (item) => {
        const product = await tx.product.findUnique({ where: { sku: item.sku }, include: { inventory: true } });
        if (!product?.inventory) throw new AppError(`Unknown or unstocked SKU: ${item.sku}`, 422, "UNKNOWN_SKU");
        return { item, product };
      }));
      records.sort((left, right) => left.product.id.localeCompare(right.product.id));

      const created = await tx.order.create({
        data: {
          channel: input.channel as Channel,
          externalOrderId: input.external_order_id,
          status: OrderStatus.CONFIRMED,
          eventTime,
          paymentMode: input.payment_mode,
          shippingPincode: input.shipping_pincode,
          totalAmount,
          lines: { create: records.map(({ item, product }) => ({
            productId: product.id, quantity: item.qty, unitPrice: item.unit_price
          })) }
        }
      });

      for (const { item, product } of records) {
        const rows = await tx.$queryRaw<Array<{ version: number; onHand: number; reserved: number }>>`
          UPDATE "Inventory"
          SET "reserved" = "reserved" + ${item.qty}, "version" = "version" + 1, "updatedAt" = NOW()
          WHERE "productId" = ${product.id} AND "onHand" - "reserved" >= ${item.qty}
          RETURNING "version", "onHand", "reserved"
        `;
        if (rows.length === 0) throw new AppError(`Insufficient stock for SKU ${item.sku}`, 409, "INSUFFICIENT_STOCK");

        await tx.reservation.create({ data: { orderId: created.id, productId: product.id, quantity: item.qty } });
        await tx.inventoryAudit.create({
          data: { productId: product.id, orderId: created.id, reason: "ORDER_RESERVATION", deltaOnHand: 0, deltaReserved: item.qty }
        });
        await queueStockSync(tx, product.id, rows[0]!.version, rows[0]!.onHand - rows[0]!.reserved);
      }

      await tx.syncJob.create({ data: { kind: JobKind.ERP_DELIVERY, orderId: created.id } });
      await tx.outboxEvent.create({
        data: { eventType: "ORDER_CONFIRMED", aggregateId: created.id, payload: { orderId: created.id, externalOrderId: input.external_order_id } }
      });
      return created;
    });
    return { order, duplicate: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.order.findUnique({
        where: { channel_externalOrderId: { channel: input.channel as Channel, externalOrderId: input.external_order_id } }
      });
      if (duplicate) return { order: duplicate, duplicate: true };
    }
    throw error;
  }
}

export async function transitionOrder(id: string, action: "cancel" | "fulfill" | "return") {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, include: { reservations: true } });
    if (!order) throw new AppError("Order not found", 404, "ORDER_NOT_FOUND");
    const expectedStatus = action === "return" ? OrderStatus.FULFILLED : OrderStatus.CONFIRMED;
    if (order.status !== expectedStatus) {
      throw new AppError(`Cannot ${action} an order in ${order.status} state`, 409, "INVALID_ORDER_STATE");
    }

    const reservations = order.reservations.filter((entry) => action === "return" ? !entry.active : entry.active);
    for (const reservation of reservations) {
      let updated;
      if (action === "cancel") {
        updated = await tx.inventory.updateMany({
          where: { productId: reservation.productId, reserved: { gte: reservation.quantity } },
          data: { reserved: { decrement: reservation.quantity }, version: { increment: 1 } }
        });
      } else if (action === "fulfill") {
        updated = await tx.inventory.updateMany({
          where: {
            productId: reservation.productId,
            reserved: { gte: reservation.quantity },
            onHand: { gte: reservation.quantity }
          },
          data: {
            reserved: { decrement: reservation.quantity },
            onHand: { decrement: reservation.quantity },
            version: { increment: 1 }
          }
        });
      } else {
        updated = await tx.inventory.updateMany({
          where: { productId: reservation.productId },
          data: { onHand: { increment: reservation.quantity }, version: { increment: 1 } }
        });
      }
      if (updated.count !== 1) throw new AppError("Inventory reservation is inconsistent", 409, "RESERVATION_INCONSISTENT");

      const inventory = await tx.inventory.findUniqueOrThrow({ where: { productId: reservation.productId } });
      if (action !== "return") {
        const reservationUpdate = await tx.reservation.updateMany({
          where: { id: reservation.id, active: true },
          data: { active: false, releasedAt: new Date() }
        });
        if (reservationUpdate.count !== 1) throw new AppError("Reservation was already released", 409, "RESERVATION_INACTIVE");
      }
      await tx.inventoryAudit.create({
        data: {
          productId: reservation.productId,
          orderId: id,
          reason: action === "cancel" ? "ORDER_CANCELLED" : action === "fulfill" ? "ORDER_FULFILLED" : "RETURN_RESTOCKED",
          deltaOnHand: action === "fulfill" ? -reservation.quantity : action === "return" ? reservation.quantity : 0,
          deltaReserved: action === "return" ? 0 : -reservation.quantity
        }
      });
      await queueStockSync(tx, reservation.productId, inventory.version, inventory.onHand - inventory.reserved);
    }

    const status = action === "cancel" ? OrderStatus.CANCELLED : action === "fulfill" ? OrderStatus.FULFILLED : OrderStatus.RETURNED;
    return tx.order.update({ where: { id }, data: { status } });
  });
}

export async function retryJob(id: string) {
  const job = await prisma.syncJob.findUnique({ where: { id } });
  if (!job) throw new AppError("Sync job not found", 404, "JOB_NOT_FOUND");
  if (job.status !== JobStatus.FAILED) throw new AppError("Only failed jobs can be retried", 409, "JOB_NOT_FAILED");
  const result = await prisma.syncJob.updateMany({
    where: { id, status: JobStatus.FAILED },
    data: { status: JobStatus.PENDING, attempts: 0, lastError: null, nextAttemptAt: new Date() }
  });
  if (result.count !== 1) throw new AppError("Job changed before retry was queued", 409, "JOB_STATE_CHANGED");
  return prisma.syncJob.findUniqueOrThrow({ where: { id } });
}
