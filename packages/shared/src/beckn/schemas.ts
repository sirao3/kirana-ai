/**
 * Zod schemas for the Beckn / ONDC Retail v1.2.x fields KiranaAI uses (see VERSION).
 * Objects are .passthrough() so extra spec fields survive round trips.
 * Money in payloads is a rupee string ("450.00"); convert with priceOf()/paiseOf().
 */
import { z } from "zod";

export const REQUEST_ACTIONS = ["search", "select", "init", "confirm", "status", "cancel"] as const;
export const CALLBACK_ACTIONS = ["on_search", "on_select", "on_init", "on_confirm", "on_status", "on_cancel"] as const;
export type RequestAction = (typeof REQUEST_ACTIONS)[number];
export type CallbackAction = (typeof CALLBACK_ACTIONS)[number];
export type BecknAction = RequestAction | CallbackAction;
export const BecknActionSchema = z.enum([...REQUEST_ACTIONS, ...CALLBACK_ACTIONS]);

export const Context = z
  .object({
    domain: z.string(),
    country: z.string(),
    city: z.string(),
    action: BecknActionSchema,
    core_version: z.string(),
    bap_id: z.string(),
    bap_uri: z.string().url(),
    bpp_id: z.string().optional(),
    bpp_uri: z.string().url().optional(),
    transaction_id: z.string().min(1),
    message_id: z.string().min(1),
    timestamp: z.string(),
    ttl: z.string().optional(),
  })
  .passthrough();
export type Context = z.infer<typeof Context>;

export const BecknError = z
  .object({ type: z.string(), code: z.string(), message: z.string().optional(), path: z.string().optional() })
  .passthrough();
export type BecknError = z.infer<typeof BecknError>;

export const AckResponse = z.object({
  message: z.object({ ack: z.object({ status: z.enum(["ACK", "NACK"]) }) }),
  error: BecknError.optional(),
});
export type AckResponse = z.infer<typeof AckResponse>;

/** ONDC sends counts as strings in catalogs and numbers in orders; accept both. */
const Count = z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)]);

export const Price = z
  .object({ currency: z.literal("INR"), value: z.string().regex(/^-?\d+(\.\d{1,2})?$/), maximum_value: z.string().optional() })
  .passthrough();
export type Price = z.infer<typeof Price>;

export const Descriptor = z
  .object({ name: z.string().optional(), code: z.string().optional(), short_desc: z.string().optional(), long_desc: z.string().optional() })
  .passthrough();

export const Tag = z.object({
  code: z.string(),
  list: z.array(z.object({ code: z.string(), value: z.string() })),
});
export type Tag = z.infer<typeof Tag>;

export const Location = z
  .object({ id: z.string().optional(), gps: z.string(), address: z.unknown().optional() })
  .passthrough();

export const CatalogItem = z
  .object({
    id: z.string(),
    descriptor: Descriptor,
    price: Price,
    quantity: z
      .object({
        available: z.object({ count: Count }).optional(),
        maximum: z.object({ count: Count }).optional(),
        unitized: z.object({ measure: z.object({ unit: z.string(), value: z.string() }) }).optional(),
      })
      .passthrough()
      .optional(),
    category_id: z.string().optional(),
    fulfillment_id: z.string().optional(),
    location_id: z.string().optional(),
    tags: z.array(Tag).optional(),
  })
  .passthrough();
export type CatalogItem = z.infer<typeof CatalogItem>;

export const FulfillmentStateCode = z.enum(["Pending", "Packed", "Order-picked-up", "Out-for-delivery", "Order-delivered", "Cancelled"]);

export const Fulfillment = z
  .object({
    id: z.string(),
    type: z.string().optional(), // "Delivery"
    "@ondc/org/category": z.string().optional(),
    "@ondc/org/TAT": z.string().optional(),
    state: z.object({ descriptor: z.object({ code: z.string() }).passthrough() }).passthrough().optional(),
    end: z
      .object({
        location: Location,
        contact: z.object({ phone: z.string().optional(), email: z.string().optional() }).passthrough().optional(),
        person: z.object({ name: z.string().optional() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
    tags: z.array(Tag).optional(),
  })
  .passthrough();
export type Fulfillment = z.infer<typeof Fulfillment>;

export const Provider = z
  .object({
    id: z.string(),
    descriptor: Descriptor,
    locations: z.array(Location).optional(),
    items: z.array(CatalogItem),
    fulfillments: z.array(Fulfillment).optional(),
    tags: z.array(Tag).optional(),
  })
  .passthrough();
export type Provider = z.infer<typeof Provider>;

export const Catalog = z
  .object({ "bpp/descriptor": Descriptor.optional(), "bpp/providers": z.array(Provider) })
  .passthrough();
export type Catalog = z.infer<typeof Catalog>;

export const BreakupTitleType = z.enum(["item", "delivery", "packing", "tax", "discount", "misc"]);

export const Quote = z
  .object({
    price: Price,
    breakup: z.array(
      z
        .object({
          "@ondc/org/item_id": z.string(),
          "@ondc/org/item_quantity": z.object({ count: Count }).optional(),
          "@ondc/org/title_type": BreakupTitleType,
          title: z.string(),
          price: Price,
          item: z.object({ price: Price, quantity: z.unknown().optional() }).passthrough().optional(),
        })
        .passthrough(),
    ),
    ttl: z.string().optional(),
  })
  .passthrough();
export type Quote = z.infer<typeof Quote>;

export const OrderState = z.enum(["Created", "Accepted", "In-progress", "Completed", "Cancelled"]);
export type OrderState = z.infer<typeof OrderState>;

export const OrderItem = z
  .object({ id: z.string(), quantity: z.object({ count: Count }), fulfillment_id: z.string().optional(), tags: z.array(Tag).optional() })
  .passthrough();

export const Billing = z
  .object({ name: z.string(), phone: z.string(), address: z.unknown().optional(), email: z.string().optional() })
  .passthrough();

export const Payment = z
  .object({
    type: z.string(), // "ON-ORDER"
    collected_by: z.string().optional(),
    status: z.enum(["PAID", "NOT-PAID"]).optional(),
    params: z.object({ amount: z.string(), currency: z.literal("INR"), transaction_id: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

export const Order = z
  .object({
    id: z.string().optional(),
    state: OrderState.optional(),
    provider: z.object({ id: z.string(), locations: z.array(z.object({ id: z.string() }).passthrough()).optional() }).passthrough(),
    items: z.array(OrderItem),
    billing: Billing.optional(),
    fulfillments: z.array(Fulfillment).optional(),
    quote: Quote.optional(),
    payment: Payment.optional(),
    cancellation: z
      .object({ cancelled_by: z.string(), reason: z.object({ id: z.string(), descriptor: Descriptor.optional() }).passthrough() })
      .passthrough()
      .optional(),
    tags: z.array(Tag).optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();
export type Order = z.infer<typeof Order>;

export const SearchMessage = z.object({
  intent: z
    .object({
      item: z.object({ descriptor: Descriptor.optional() }).passthrough().optional(),
      fulfillment: z.object({ type: z.string().optional(), end: z.object({ location: Location }).passthrough().optional() }).passthrough().optional(),
      tags: z.array(Tag).optional(),
    })
    .passthrough(),
});
export const OnSearchMessage = z.object({ catalog: Catalog });
export const OrderMessage = z.object({ order: Order });
export const StatusMessage = z.object({ order_id: z.string() });
export const CancelMessage = z.object({ order_id: z.string(), cancellation_reason_id: z.string(), descriptor: Descriptor.optional() });

export type SearchMessage = z.infer<typeof SearchMessage>;
export type OnSearchMessage = z.infer<typeof OnSearchMessage>;
export type OrderMessage = z.infer<typeof OrderMessage>;
export type StatusMessage = z.infer<typeof StatusMessage>;
export type CancelMessage = z.infer<typeof CancelMessage>;

/** Message schema per action. on_* may also arrive with only `error` (message omitted). */
export const MessageSchemas = {
  search: SearchMessage,
  select: OrderMessage,
  init: OrderMessage,
  confirm: OrderMessage,
  status: StatusMessage,
  cancel: CancelMessage,
  on_search: OnSearchMessage,
  on_select: OrderMessage,
  on_init: OrderMessage,
  on_confirm: OrderMessage,
  on_status: OrderMessage,
  on_cancel: OrderMessage,
} as const satisfies Record<BecknAction, z.ZodTypeAny>;

export type MessageFor<A extends BecknAction> = z.infer<(typeof MessageSchemas)[A]>;

export interface Envelope<A extends BecknAction = BecknAction> {
  context: Context & { action: A };
  message: MessageFor<A>;
  error?: BecknError;
}
