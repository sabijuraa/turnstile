import { Hono } from "hono";
import type { AppEnv, Services } from "../context.js";
import { paymentBodySchema, readJson, requirementsBodySchema } from "../validation.js";

/** The x402 facilitator endpoints. */
export function x402Routes(s: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/supported", (c) => c.json(s.facilitator.supported()));

  app.post("/requirements", async (c) => {
    const body = await readJson(c, requirementsBodySchema);
    const requirements = await s.facilitator.requirements(body, c.get("log"));
    return c.json(requirements);
  });

  app.post("/verify", async (c) => {
    const body = await readJson(c, paymentBodySchema);
    return c.json(
      await s.facilitator.verify(body.paymentPayload, body.paymentRequirements, c.get("log")),
    );
  });

  app.post("/settle", async (c) => {
    const body = await readJson(c, paymentBodySchema);
    return c.json(
      await s.facilitator.settle(body.paymentPayload, body.paymentRequirements, c.get("log")),
    );
  });

  return app;
}
