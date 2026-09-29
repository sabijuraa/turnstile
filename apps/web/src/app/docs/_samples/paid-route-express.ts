import { expressPaywall, getSettlement } from "@turnstile/sdk-resource";
import express from "express";

const payTo = process.env.PAY_TO;
if (!payTo) throw new Error("Set PAY_TO to the Solana address that should receive payments.");

const app = express();

// The paywall reads headers only, so body parsers can come after it.
app.use(
  expressPaywall({
    facilitatorUrl: process.env.FACILITATOR_URL ?? "http://127.0.0.1:4020",
    payTo,
    publicUrl: "http://127.0.0.1:4030",
    routes: {
      "POST /v1/summarize": { price: "0.005", description: "Summarize a text" },
    },
  }),
);
app.use(express.json());

app.post("/v1/summarize", (req, res) => {
  const text = String(req.body?.text ?? "");
  // The settlement that paid for this request. Also on res.locals.turnstilePayment.
  const settlement = getSettlement(req);
  res.json({ summary: text.split(". ")[0], receipt: settlement?.receipt });
});

app.listen(4030, "127.0.0.1");
