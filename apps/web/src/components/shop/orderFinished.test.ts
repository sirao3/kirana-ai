import { describe, expect, it } from "vitest";
import type { OrderView, SubOrderStatus, SubOrderView } from "@kiranaai/shared";
import { orderFinished } from "./OrderDetail";

const sub = (status: SubOrderStatus) => ({ status }) as SubOrderView;
const order = (settled: boolean, statuses: SubOrderStatus[]) => ({ settled, subOrders: statuses.map(sub) }) as OrderView;

describe("orderFinished", () => {
  it("is true once settled", () => expect(orderFinished(order(true, ["DELIVERED", "DELIVERED"]))).toBe(true));
  it("is false while delivered but not yet settled", () => expect(orderFinished(order(false, ["DELIVERED", "DELIVERED"]))).toBe(false));
  it("is false while a store is still working", () => expect(orderFinished(order(false, ["DELIVERED", "PREPARING"]))).toBe(false));
  it("is true when no store could fulfil anything (refunded)", () => expect(orderFinished(order(false, ["FAILED_NO_FULFILMENT"]))).toBe(true));
  it("is false before any sub-order exists", () => expect(orderFinished(order(false, []))).toBe(false));
});
