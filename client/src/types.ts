export type Channel = "WEBSITE" | "NYKAA" | "FLIPKART" | "BLINKIT";

export interface Summary {
  ordersToday: number;
  skusWithReservations: number;
  pendingJobs: number;
  failedJobs: number;
  erpPending: number;
  integrations: "MOCK";
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  unitPrice: string;
  onHand: number;
  reserved: number;
  available: number;
  version: number;
  channels: { channel: Channel; lastSyncedQty: number | null; lastSyncedAt: string | null }[];
}

export interface Order {
  id: string;
  channel: Channel;
  externalOrderId: string;
  status: string;
  totalAmount: string;
  createdAt: string;
  lines: { id: string; quantity: number; unitPrice: string; product: { sku: string; name: string } }[];
}

export interface SyncJob {
  id: string;
  kind: "STOCK_SYNC" | "ERP_DELIVERY";
  channel: Channel | null;
  orderId: string | null;
  productId: string | null;
  desiredQty: number | null;
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED";
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}
