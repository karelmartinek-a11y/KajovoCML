export type DashboardStreamItem<T = unknown> = {
  key: string;
  orderUs: bigint;
  orderRank: number;
  event: T;
};

export type DashboardStreamCursor = Pick<DashboardStreamItem, "orderUs" | "orderRank" | "key">;

export function compareDashboardStreamItems(left: DashboardStreamItem, right: DashboardStreamItem): number {
  if (left.orderUs < right.orderUs) return -1;
  if (left.orderUs > right.orderUs) return 1;
  if (left.orderRank !== right.orderRank) return left.orderRank - right.orderRank;
  return left.key.localeCompare(right.key);
}

export function dashboardStreamItemIsAfter(item: DashboardStreamItem, cursor: DashboardStreamCursor): boolean {
  return compareDashboardStreamItems(item, { ...cursor, event: null }) > 0;
}
