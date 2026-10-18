# ONDC deviations

KiranaAI is **ONDC-aligned, not ONDC-compliant**. Payload shapes follow the ONDC Retail API
contract v1.2.x (`ONDC:RET10`, `core_version` 1.2.0) for the fields we use; see
`packages/shared/src/beckn/VERSION` and `schemas.ts`.

## Protocol
| Area | ONDC | KiranaAI |
|---|---|---|
| Authentication | Signed `Authorization` header, registry public keys | No signing. The receiver checks the sender's `bap_id`/`bpp_id` and URI against the local registry instead. |
| Registry | ONDC registry, `/subscribe`, `/on_subscribe` | Local `registry.participant` table seeded at reset; `/gw/lookup` returns it. No subscribe flow. |
| ACK timing | ACK on receipt, process asynchronously | The handler runs **before** the ACK is returned (Cloud Run with request-based CPU can starve work done after a response). Callbacks can therefore arrive before the ACK; the BAP registers its waiter before sending. |
| Reassignment | New order to a different provider | Same `transaction_id`, new `order.id` (`att_…`); the search carries an empty `intent.item.descriptor.name` plus the `canonical_ids` tag. The BAP reassigns inside the `on_cancel` handler, before it ACKs. |
| Offer window | — | The BAP sends `offer_window_seconds` as a `confirm` order tag; the BPP owns the timer and returns `expires_at` as an `on_confirm` tag. |
| Cancellation reasons | Numeric ONDC reason codes | `MERCHANT_REJECTED` and `OFFER_EXPIRED`, with the merchant's text in `descriptor.name`. `cancel` from the BAP is not supported (NACK `30000`). |
| Error codes | ONDC error catalogue | Subset: `40002` item unavailable / short stock (message = listing ids), `30009` outside delivery radius, `30001` store offline, closed or unknown, `30004` unknown order on `status`. |
| Callback retries | — | Unsolicited `on_status`/`on_cancel` are retried 3× with backoff and the same `message_id`; the BAP reconciler polls `status` as a backstop. |
| Confirm pricing | Agreed quote | The BPP re-prices from current listings at `confirm`; the BAP pays the store its own quote and records any difference as platform subsidy. |
| Dedupe | — | `(message_id, action, sender→receiver)` unique in `beckn_message`; repeats are ACKed and ignored. |
| One BPP, many providers | Typical | One BPP (`kiranaai-bpp`) hosts the 5 stores as providers; all modules run in one process and talk over real HTTP to `SELF_BASE_URL`. |

## Tags (group `kiranaai`)
| Where | Code | Meaning |
|---|---|---|
| `search` intent | `canonical_ids` | Comma-separated canonical product ids; used for reassignment searches. |
| `search` intent | `customer_id` | Lets the BPP compute distance and serviceability for this customer. |
| catalog item | `canonical_id` | Canonical product id of the listing (equivalence across stores). |
| provider | `distance_m`, `delivery_charge`, `delivery_rule` | Distance to the customer, delivery charge for an empty subtotal, and the full rule as JSON (lets the optimiser price `free_above`). |
| catalog item | `brand`, `product_name`, `pack_label` | Display fields. |
| catalog | `loose_declined`, `reason`, `alternative_canonical_id` | A loose request was declined; the packaged alternative's listings are still returned. |
| `select` item / `on_select` breakup item | `seen_price` / `price_changed`, `previous_price` | Price-change highlighting (CHK-02). |
| `confirm` order / `on_confirm` order | `offer_window_seconds` / `expires_at` | Timed offers (DSP-01). |

## Delivery address and serviceability helper (UX-14)
- The customer's delivery address is BAP profile data (`bap.customer`, `GET/PATCH /bap/profile/address`). It reaches the BPP unchanged as the `search`/`select` `fulfillment.end.location.gps`, so no Beckn payload changed.
- `GET /bpp/serviceability?lat=&lng=` is a kiranaai helper outside the Beckn action set (no Beckn envelope, no signature): it returns each store's position, delivery radius and distance to the point, for the address sheet and map only. In ONDC a BAP would learn serviceability only from `on_search`. Search and select still decide serviceability themselves.
- No Google Places autocomplete (no browser key available): the UI offers preset demo addresses (`ADDRESS_PRESETS` in `packages/shared/src/api.ts`); the PATCH route also accepts a custom `{address, lat, lng}`.

## Not implemented
Signing and auth headers, `/subscribe`, ONDC log verification, IGM, RSF, `update`, rating,
support, real payments (simulated), GST invoicing.
