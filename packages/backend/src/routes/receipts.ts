import { Hono } from "hono";
import { requireOwner } from "../auth/middleware.js";
import { explorerNetwork } from "../config.js";
import type { AppEnv, Services } from "../context.js";
import { csvHeader, csvRow } from "../store/csv.js";
import { listReceipts, receiptFilterSchema, receiptListSchema } from "../store/receipts.js";
import { readQuery } from "../validation.js";

const CSV_PAGE = 500;

export function receiptRoutes(s: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const network = explorerNetwork(s.config);
  app.use("*", requireOwner(s, { apiKey: true }));

  app.get("/", async (c) => {
    const q = readQuery(c, receiptListSchema);
    const page = await listReceipts(s.pool, network, c.get("owner"), q, {
      limit: q.limit,
      cursor: q.cursor,
    });
    return c.json(page);
  });

  return app;
}

/** GET /v1/receipts.csv streams every matching receipt, page by page, as a CSV statement. */
export function receiptCsvRoute(s: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const network = explorerNetwork(s.config);
  app.get("/", requireOwner(s, { apiKey: true }), async (c) => {
    const filter = readQuery(c, receiptFilterSchema);
    const owner = c.get("owner");
    const log = c.get("log");
    // Fetch the first page before answering so a bad query still gets a JSON error.
    let page = await listReceipts(s.pool, network, owner, filter, { limit: CSV_PAGE });
    let sentHeader = false;
    let rows = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (!sentHeader) {
            sentHeader = true;
            controller.enqueue(encoder.encode(csvHeader()));
          }
          if (page.receipts.length > 0) {
            controller.enqueue(encoder.encode(page.receipts.map(csvRow).join("")));
            rows += page.receipts.length;
            s.metrics.csvRows.inc(page.receipts.length);
          }
          if (page.nextCursor === null) {
            log.info({ owner, rows }, "csv statement exported");
            controller.close();
            return;
          }
          page = await listReceipts(s.pool, network, owner, filter, {
            limit: CSV_PAGE,
            cursor: page.nextCursor,
          });
        } catch (err) {
          log.error({ err, owner, rows }, "csv statement export failed part way");
          controller.error(err);
        }
      },
    });
    s.metrics.csvExports.inc();
    const stamp = s.clock().toISOString().slice(0, 10);
    return c.body(body, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="turnstile-receipts-${stamp}.csv"`,
      "cache-control": "no-store",
    });
  });
  return app;
}
