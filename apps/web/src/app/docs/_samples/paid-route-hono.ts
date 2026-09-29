import { serve } from "@hono/node-server";
import { honoPaywall, type PaywallEnv } from "@turnstile/sdk-resource";
import { Hono } from "hono";

// The address that receives payments. It owns the token account that gets credited.
const payTo = process.env.PAY_TO;
if (!payTo) throw new Error("Set PAY_TO to the Solana address that should receive payments.");

const app = new Hono<PaywallEnv>();

app.use(
  "*",
  honoPaywall({
    facilitatorUrl: process.env.FACILITATOR_URL ?? "http://127.0.0.1:4020",
    payTo,
    // The origin agents call. Allow-lists are keyed by this origin plus the path.
    publicUrl: "http://127.0.0.1:4030",
    routes: {
      "POST /v1/summarize": { price: "0.005", description: "Summarize a text" },
    },
  }),
);

// Free routes pass straight through the paywall.
app.get("/health", (c) => c.json({ ok: true }));

// This handler runs only after the payment settled on chain.
app.post("/v1/summarize", async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  const payment = c.get("turnstilePayment");
  return c.json({ summary: text.split(". ")[0], receipt: payment?.receipt });
});

serve({ fetch: app.fetch, port: 4030, hostname: "127.0.0.1" });
