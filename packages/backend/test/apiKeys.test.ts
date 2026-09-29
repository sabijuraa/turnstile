import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth/crypto.js";
import { closePool, type Harness, harness, jsonPost, resetDb, signIn } from "./helpers.js";

interface Created {
  key: string;
  notice: string;
  apiKey: { id: string; name: string; prefix: string; status: string; lastUsedAt: string | null };
}

describe("console api keys", () => {
  let h: Harness;
  let cookie: string;
  beforeEach(async () => {
    h = await harness();
    await resetDb(h.pool);
    cookie = await signIn(h);
  });
  afterAll(closePool);

  async function create(name = "reporting job"): Promise<Created> {
    const res = await h.app.request("/v1/api-keys", jsonPost({ name }, { cookie }));
    expect(res.status).toBe(201);
    return (await res.json()) as Created;
  }

  it("shows the key once and stores only its hash", async () => {
    const created = await create();
    expect(created.key).toMatch(/^tsk_[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(created.apiKey.prefix).toBe(created.key.slice(0, 10));
    expect(created.apiKey.status).toBe("active");

    const dump = await h.pool.query("SELECT row_to_json(k)::text AS row FROM api_keys k");
    expect(dump.rows).toHaveLength(1);
    const row = dump.rows[0].row as string;
    expect(row).not.toContain(created.key);
    expect(row).not.toContain(created.key.slice(4));
    expect(row).toContain(sha256Hex(created.key));

    const list = await h.app.request("/v1/api-keys", { headers: { cookie } });
    const body = JSON.stringify(await list.json());
    expect(body).not.toContain(created.key);
    expect(body).toContain(created.apiKey.prefix);
  });

  it("authenticates read endpoints with a bearer key and records last use", async () => {
    const created = await create();
    const res = await h.app.request("/v1/me", {
      headers: { authorization: `Bearer ${created.key}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ authMethod: "api_key" });
    const receipts = await h.app.request("/v1/receipts", {
      headers: { authorization: `Bearer ${created.key}` },
    });
    expect(receipts.status).toBe(200);
    const row = await h.pool.query("SELECT last_used_at FROM api_keys WHERE id = $1", [
      created.apiKey.id,
    ]);
    expect(row.rows[0].last_used_at.toISOString()).toBe("2026-09-29T12:30:00.000Z");
  });

  it("rejects a revoked key with a clear error", async () => {
    const created = await create();
    const del = await h.app.request(`/v1/api-keys/${created.apiKey.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toMatchObject({ apiKey: { status: "revoked" } });
    const res = await h.app.request("/v1/receipts", {
      headers: { authorization: `Bearer ${created.key}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: {
        code: "api_key_revoked",
        message:
          "This API key was revoked. Create a new key in console settings and use it instead.",
      },
    });
  });

  it("rejects an unknown key", async () => {
    const res = await h.app.request("/v1/summary", {
      headers: { authorization: "Bearer tsk_2VfUX7dUbd3jVDy1vFf9zYzqqsQ5W8vcBDoRi4E1tdfs" },
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_api_key");
  });

  it("does not let a bearer key manage keys", async () => {
    const created = await create();
    const res = await h.app.request(
      "/v1/api-keys",
      jsonPost({ name: "escalate" }, { authorization: `Bearer ${created.key}` }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "api_key_not_allowed",
    );
  });

  it("does not let another owner revoke or see a key", async () => {
    const created = await create();
    const other = await signIn(h);
    const del = await h.app.request(`/v1/api-keys/${created.apiKey.id}`, {
      method: "DELETE",
      headers: { cookie: other },
    });
    expect(del.status).toBe(404);
    const list = await h.app.request("/v1/api-keys", { headers: { cookie: other } });
    expect(await list.json()).toEqual({ apiKeys: [] });
  });

  it("validates the key name", async () => {
    const res = await h.app.request("/v1/api-keys", jsonPost({ name: "  " }, { cookie }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "invalid_request", message: "name is required." },
    });
  });
});
