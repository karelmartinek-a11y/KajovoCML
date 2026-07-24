import { describe, expect, it } from "vitest";
import { compareDashboardStreamItems, dashboardStreamItemIsAfter } from "./dashboard-event-stream.js";

describe("Dashboard stream ordering", () => {
  it("orders STARTED before FINAL at the same persisted instant", () => {
    const items = [
      { key: "pulse:b", orderUs: 10n, orderRank: 1, event: "final" },
      { key: "lease:a", orderUs: 10n, orderRank: 0, event: "started" }
    ].sort(compareDashboardStreamItems);
    expect(items.map((item) => item.event)).toEqual(["started", "final"]);
  });

  it("uses the stable event key as the final cursor tie-breaker", () => {
    expect(dashboardStreamItemIsAfter(
      { key: "pulse:b", orderUs: 10n, orderRank: 1, event: null },
      { key: "pulse:a", orderUs: 10n, orderRank: 1 }
    )).toBe(true);
  });
});
