import { z } from "zod";

export const orderSchema = z.object({
  channel: z.enum(["WEBSITE", "NYKAA", "FLIPKART", "BLINKIT"]),
  external_order_id: z.string().min(1).max(120),
  event_time: z.string().datetime({ offset: true }).optional(),
  event: z.enum(["ORDER_CREATED", "ORDER_CANCELLED", "ORDER_RETURNED"]).default("ORDER_CREATED"),
  items: z.array(z.object({
    sku: z.string().min(1),
    qty: z.number().int().positive(),
    unit_price: z.number().nonnegative()
  })).max(100).optional(),
  payment_mode: z.string().default("PREPAID"),
  shipping_pincode: z.string().max(12).optional(),
  total_amount: z.number().nonnegative().optional()
}).superRefine((value, context) => {
  const items = value.items ?? [];
  if (value.event === "ORDER_CREATED" && items.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "An order needs at least one item", path: ["items"] });
  }
  const skus = items.map((item) => item.sku);
  if (new Set(skus).size !== skus.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "An order may contain each SKU only once", path: ["items"] });
  }
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  channel: z.enum(["WEBSITE", "NYKAA", "FLIPKART", "BLINKIT"]).optional()
});

export const orderListSchema = paginationSchema.extend({
  status: z.enum(["CONFIRMED", "REJECTED", "FULFILLED", "CANCELLED", "RETURNED"]).optional()
});

export const jobListSchema = paginationSchema.extend({
  status: z.enum(["PENDING", "PROCESSING", "SUCCEEDED", "FAILED"]).optional()
});
