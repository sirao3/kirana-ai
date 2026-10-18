// Voice-over for the demo video, one entry per beat. `id` must match a beat in record.mjs.
// ~150 words per minute at speakingRate 1.0; long waits in the app (agent turn, offer timeout) have lines that cover them.
export const VOICE = { languageCode: "en-IN", name: "en-IN-Neural2-B", speakingRate: 1.02 };

export const NARRATION = [
  { id: "intro", text: "This is KiranaAI: agentic commerce for neighbourhood kirana stores, built on Beckn and ONDC. A family can ask for the week's groceries in plain Hinglish or English, and an AI agent shops across the small stores around them, instead of one big warehouse." },
  { id: "map", text: "Here is our customer's neighbourhood: five real kirana stores within three kilometres, each with its own prices, stock and delivery rules. Let's start the live demo." },
  { id: "cockpit", text: "The demo cockpit shows both sides of the market. The customer talks to the assistant on the left. The stores live on the map." },
  { id: "ask", text: "Our customer types one sentence: weekly groceries for four people, under fifteen hundred rupees: atta, toor dal, milk and tea." },
  { id: "thinking", text: "Gemini, running on Vertex AI, now works through tools. It searches the stores' catalogues over Beckn, suggests sensible quantities for a family of four, and runs an optimiser that picks the cheapest combination of stores, then fewer stores, then shorter distance." },
  { id: "basket", text: "The result: one basket split across three stores, Sharma, Gupta and Lakshmi, with a reason on every line. Quantities the agent guessed are marked as suggestions, and the customer confirms them before anything is priced." },
  { id: "quote", text: "Next, the platform asks each store for a verified quote. The total always comes from the stores, never from the model." },
  { id: "pay", text: "And here is the key guardrail: the agent can plan, but it can never pay or confirm. Only this button, pressed by the customer, approves the order. One tap: approve and pay fourteen hundred rupees." },
  { id: "offers", text: "Payment is held, and the order splits into three store orders. Switching to the stores: all three shopkeepers get a ringing offer with the items, their payout and a countdown." },
  { id: "accept", text: "Sharma General accepts straight away." },
  { id: "decline", text: "Lakshmi Stores is out of stock, so they decline with a reason. Within about a second, KiranaAI re-dispatches that order to the next best store, Annapurna Provisions." },
  { id: "annapurna", text: "Annapurna accepts. The customer's price is locked at the quote: if a replacement store costs more, the platform covers the difference." },
  { id: "timeout", text: "Gupta Kirana simply doesn't answer. Shopkeepers are busy, and that's normal. When the offer window runs out, the order moves on automatically, with no one on the phone. Every step is a real Beckn message between our buyer app and seller app: search, select, init, confirm, and cancel with reassignment." },
  { id: "balaji", text: "Balaji Mart picks up Gupta's items and accepts. Again, the customer pays the original price, and KiranaAI covers the extra forty rupees." },
  { id: "deliver", text: "Now the stores pack and send out their orders. Each store moves its own order through packing, ready, out for delivery and delivered, and the customer sees every step live." },
  { id: "settled", text: "Every store order has arrived. Only now is the held payment settled and paid out to each merchant." },
  { id: "jeera", text: "One more request, this time in Hinglish: two hundred and fifty grams of jeera. The stores only sell jeera in hundred gram packs, and the agent can only order whole packs from real listings. So instead of inventing a product, it explains that and offers the pack that actually exists." },
  { id: "ledger", text: "The admin ledger shows exactly who earned what: each merchant's net payout, and the forty rupee subsidy the platform paid to keep its price promise." },
  { id: "audit", text: "And the audit log keeps every Beckn message and state change for each transaction, so every decision the system made can be traced." },
  { id: "arch", text: "Under the hood, one Cloud Run service hosts the buyer app, the seller apps and the agent, and they talk to each other in Beckn messages over HTTP. Orders live in Postgres on Compute Engine. Gemini on Vertex AI plans the baskets, and the Gemini Live API lets customers simply speak their list." },
  { id: "outro", text: "KiranaAI: one sentence from the customer, three neighbourhood stores, automatic recovery when a store says no, and a human always in control of the money. Built on Google Cloud with Gemini. Thank you." },
];
