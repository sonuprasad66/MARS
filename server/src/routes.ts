import { Channel, JobStatus, OrderStatus, Prisma } from "@prisma/client";
import { Router } from "express";
import { ZodError } from "zod";
import { prisma } from "./db.js";
import { AppError } from "./errors.js";
import { ingestOrder, retryJob, transitionOrder } from "./services/orders.js";
import { jobListSchema, orderListSchema, orderSchema, paginationSchema } from "./schemas.js";

export const router = Router();

router.get("/health", (_req, res) => res.json({ status: "ok" }));
router.get("/ready", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "ready", database: "connected" });
});

router.get("/dashboard/summary", async (_req, res) => {
  const [ordersToday, inventoryRows, pendingJobs, failedJobs, erpPending] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    prisma.inventory.count({ where: { reserved: { gt: 0 } } }),
    prisma.syncJob.count({ where: { status: { in: [JobStatus.PENDING, JobStatus.PROCESSING] } } }),
    prisma.syncJob.count({ where: { status: JobStatus.FAILED } }),
    prisma.syncJob.count({ where: { kind: "ERP_DELIVERY", status: { in: [JobStatus.PENDING, JobStatus.FAILED] } } })
  ]);
  res.json({ ordersToday, skusWithReservations: inventoryRows, pendingJobs, failedJobs, erpPending, integrations: "MOCK" });
});

router.get("/inventory", async (req, res) => {
  const query = paginationSchema.parse(req.query);
  const where: Prisma.ProductWhereInput = query.search ? {
    OR: [{ sku: { contains: query.search, mode: "insensitive" } }, { name: { contains: query.search, mode: "insensitive" } }]
  } : {};
  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where, include: { inventory: true, channelListings: true },
      orderBy: { sku: "asc" }, skip: (query.page - 1) * query.limit, take: query.limit
    })
  ]);
  res.json({
    items: products.map(({ inventory, channelListings, ...product }) => ({
      ...product,
      unitPrice: product.unitPrice.toString(),
      onHand: inventory?.onHand ?? 0,
      reserved: inventory?.reserved ?? 0,
      available: (inventory?.onHand ?? 0) - (inventory?.reserved ?? 0),
      version: inventory?.version ?? 0,
      channels: channelListings
    })),
    page: query.page, limit: query.limit, total
  });
});

router.get("/orders", async (req, res) => {
  const query = orderListSchema.parse(req.query);
  const where: Prisma.OrderWhereInput = {
    ...(query.status ? { status: query.status as OrderStatus } : {}),
    ...(query.channel ? { channel: query.channel as Channel } : {})
  };
  const [total, items] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, include: { lines: { include: { product: true } } }, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit })
  ]);
  res.json({ items, page: query.page, limit: query.limit, total });
});

router.post("/orders", async (req, res) => {
  const parsed = orderSchema.parse(req.body);
  if (parsed.event !== "ORDER_CREATED") {
    const existing = await prisma.order.findUnique({
      where: { channel_externalOrderId: { channel: parsed.channel, externalOrderId: parsed.external_order_id } }
    });
    if (!existing) throw new AppError("Order not found for lifecycle event", 404, "ORDER_NOT_FOUND");
    const order = await transitionOrder(existing.id, parsed.event === "ORDER_CANCELLED" ? "cancel" : "return");
    res.json({ order, duplicate: false });
    return;
  }
  const result = await ingestOrder(req.body);
  res.status(result.duplicate ? 200 : 201).json(result);
});

router.post("/orders/:id/cancel", async (req, res) => res.json(await transitionOrder(req.params.id, "cancel")));
router.post("/orders/:id/fulfill", async (req, res) => res.json(await transitionOrder(req.params.id, "fulfill")));
router.post("/orders/:id/return", async (req, res) => res.json(await transitionOrder(req.params.id, "return")));

router.get("/sync-jobs", async (req, res) => {
  const query = jobListSchema.parse({ ...req.query, status: typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined });
  const where = query.status ? { status: query.status as JobStatus } : {};
  const [total, items] = await Promise.all([
    prisma.syncJob.count({ where }),
    prisma.syncJob.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit })
  ]);
  res.json({ items, page: query.page, limit: query.limit, total });
});
router.post("/sync-jobs/:id/retry", async (req, res) => res.json(await retryJob(req.params.id)));

router.post("/imports/blinkit", async (req, res) => {
  const csv = zCsv(req.body?.csv);
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length > 1001) throw new AppError("CSV is limited to 1,000 data rows", 413, "CSV_TOO_LARGE");
  const header = lines.shift()?.split(",").map((column) => column.trim().toLowerCase());
  const expected = ["order_id", "sku", "qty", "unit_price"];
  if (!header || expected.some((column) => !header.includes(column))) {
    throw new AppError("CSV must include order_id,sku,qty,unit_price headers", 400, "INVALID_CSV_HEADER");
  }

  const columnIndex = Object.fromEntries(header.map((column, index) => [column, index]));
  const grouped = new Map<string, { row: number; sku: string; qty: number; unitPrice: number }[]>();
  const errors: { row: number; message: string }[] = [];
  lines.forEach((line, index) => {
    const values = line.split(",").map((value) => value.trim());
    const row = index + 2;
    const orderId = values[columnIndex.order_id ?? -1];
    const sku = values[columnIndex.sku ?? -1];
    const qty = Number(values[columnIndex.qty ?? -1]);
    const unitPrice = Number(values[columnIndex.unit_price ?? -1]);
    if (!orderId || !sku || !Number.isInteger(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      errors.push({ row, message: "Expected order_id, SKU, positive integer qty, and non-negative unit_price" });
      return;
    }
    grouped.set(orderId, [...(grouped.get(orderId) ?? []), { row, sku, qty, unitPrice }]);
  });

  const imported: string[] = [];
  for (const [externalOrderId, rows] of grouped) {
    try {
      const result = await ingestOrder({
        channel: "BLINKIT",
        external_order_id: externalOrderId,
        event: "ORDER_CREATED",
        items: rows.map(({ sku, qty, unitPrice }) => ({ sku, qty, unit_price: unitPrice })),
        payment_mode: "PREPAID"
      });
      if (!result.duplicate) imported.push(externalOrderId);
    } catch (error) {
      if (!(error instanceof AppError) && !(error instanceof ZodError)) throw error;
      errors.push({
        row: rows[0]!.row,
        message: error instanceof Error ? error.message : "Order import failed"
      });
    }
  }
  res.status(200).json({ receivedRows: lines.length, importedOrders: imported, importedCount: imported.length, errors });
});

router.get("/audit", async (req, res) => {
  const sku = zString(req.query.sku);
  const items = await prisma.inventoryAudit.findMany({
    where: sku ? { product: { sku } } : {},
    include: { product: { select: { sku: true, name: true } } },
    orderBy: { createdAt: "desc" }, take: 100
  });
  res.json({ items });
});

function zString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function zCsv(value: unknown) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_000_000) {
    throw new AppError("Provide a non-empty CSV string up to 1 MB", 400, "INVALID_CSV");
  }
  return value;
}
