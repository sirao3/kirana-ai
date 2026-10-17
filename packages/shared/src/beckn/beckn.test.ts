import { describe, expect, it } from "vitest";
import {
  AckResponse, Context, MessageSchemas, callbackContext, getTag, makeContext, nack, paiseOf, parseGps, priceOf, tag, gpsOf,
} from "./index.js";

describe("beckn helpers", () => {
  const ctx = makeContext({ action: "search", transactionId: "txn_1", bapId: "kiranaai-bap", bapUri: "http://127.0.0.1:8080/bap" });

  it("builds a valid context and callback context", () => {
    expect(Context.parse(ctx).message_id).toMatch(/^msg_/);
    const cb = callbackContext(ctx, { bppId: "kiranaai-bpp", bppUri: "http://127.0.0.1:8080/bpp" });
    expect(cb).toMatchObject({ action: "on_search", message_id: ctx.message_id, transaction_id: "txn_1", bpp_id: "kiranaai-bpp" });
  });

  it("converts prices at the edge", () => {
    expect(priceOf(45000)).toEqual({ currency: "INR", value: "450.00" });
    expect(paiseOf({ value: "67.5" })).toBe(6750);
  });

  it("parses ONDC string counts and order number counts", () => {
    const onSearch = MessageSchemas.on_search.parse({
      catalog: { "bpp/providers": [{ id: "store_x", descriptor: { name: "X" }, items: [
        { id: "lst_1", descriptor: { name: "Atta" }, price: priceOf(100), quantity: { available: { count: "12" } } },
      ] }] },
    });
    expect(onSearch.catalog["bpp/providers"][0]!.items[0]!.quantity!.available!.count).toBe(12);
    const sel = MessageSchemas.select.parse({ order: { provider: { id: "store_x" }, items: [{ id: "lst_1", quantity: { count: 2 } }] } });
    expect(sel.order.items[0]!.quantity.count).toBe(2);
  });

  it("acks, nacks, tags, gps", () => {
    expect(AckResponse.parse(nack("40002", "nope")).message.ack.status).toBe("NACK");
    expect(getTag([tag("kiranaai", { canonical_ids: "a,b" })], "kiranaai", "canonical_ids")).toBe("a,b");
    expect(parseGps(gpsOf(12.9719, 77.6412))).toEqual({ lat: 12.9719, lng: 77.6412 });
  });
});
