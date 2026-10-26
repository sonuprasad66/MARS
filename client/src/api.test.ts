import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("returns typed dashboard data from the configured API", async () => {
    const payload = { ordersToday: 3, skusWithReservations: 2, pendingJobs: 1, failedJobs: 0, erpPending: 0, integrations: "MOCK" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.summary()).resolves.toEqual(payload);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:4000/api/dashboard/summary");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("surfaces API error messages instead of returning an empty success value", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: { message: "Insufficient stock" } })
    }));

    await expect(api.summary()).rejects.toThrow("Insufficient stock");
  });
});
