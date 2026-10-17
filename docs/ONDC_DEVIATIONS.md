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
| Dedupe | — | `(message_id, action, sender→receiver)` unique in `beckn_message`; repeats are ACKed and ignored. |
| One BPP, many providers | Typical | One BPP (`kiranaai-bpp`) hosts the 5 stores as providers; all modules run in one process and talk over real HTTP to `SELF_BASE_URL`. |

## Tags (group `kiranaai`)
| Where | Code | Meaning |
|---|---|---|
| `search` intent | `canonical_ids` | Comma-separated canonical product ids; used for reassignment searches. |
| `search` intent | `customer_id` | Lets the BPP compute distance and serviceability for this customer. |
| catalog item | `canonical_id` | Canonical product id of the listing (equivalence across stores). |
| catalog item | `loose_declined`, `reason`, `alternative_item_id` | A loose request was declined; the packaged alternative. |

## Not implemented
Signing and auth headers, `/subscribe`, ONDC log verification, IGM, RSF, `update`, rating,
support, real payments (simulated), GST invoicing.
