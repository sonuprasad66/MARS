import type { InventoryItem, Order, Page, Summary, SyncJob } from "./types";

const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  summary: () => request<Summary>("/dashboard/summary"),
  inventory: (search = "") => request<Page<InventoryItem>>(`/inventory?limit=100&search=${encodeURIComponent(search)}`),
  orders: () => request<Page<Order>>("/orders?limit=50"),
  jobs: (status = "") => request<Page<SyncJob>>(`/sync-jobs?limit=100${status ? `&status=${status}` : ""}`),
  retry: (id: string) => request<SyncJob>(`/sync-jobs/${id}/retry`, { method: "POST" }),
  importBlinkit: (csv: string) => request<{ receivedRows: number; importedOrders: string[]; importedCount: number; errors: { row: number; message: string }[] }>("/imports/blinkit", {
    method: "POST",
    body: JSON.stringify({ csv })
  })
};
