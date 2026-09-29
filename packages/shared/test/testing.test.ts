import pg from "pg";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEST_DATABASE_ADMIN_URL,
  ensureTestDatabase,
  testDatabaseAdminUrl,
  testDatabaseName,
  testDatabaseUrl,
} from "../src/testing/index.js";

describe("test database convention", () => {
  it("names the database after the package", () => {
    expect(testDatabaseName("backend")).toBe("turnstile_backend_test");
    expect(testDatabaseName("demo_api")).toBe("turnstile_demo_api_test");
  });

  it("refuses names that are not plain identifiers", () => {
    expect(() => testDatabaseName("demo-api")).toThrow(/not valid/);
    expect(() => testDatabaseName("x; DROP DATABASE postgres")).toThrow(/not valid/);
  });

  it("swaps only the database name in the admin URL", () => {
    const env = {
      TEST_DATABASE_ADMIN_URL: "postgres://admin:pw@db.local:6543/postgres?sslmode=disable",
    };
    expect(testDatabaseUrl("indexer", env)).toBe(
      "postgres://admin:pw@db.local:6543/turnstile_indexer_test?sslmode=disable",
    );
  });

  it("defaults to the compose Postgres", () => {
    expect(testDatabaseAdminUrl({})).toBe(DEFAULT_TEST_DATABASE_ADMIN_URL);
    expect(testDatabaseUrl("backend", {})).toBe(
      "postgres://turnstile:turnstile@127.0.0.1:5433/turnstile_backend_test",
    );
  });

  it("creates the database once and tolerates concurrent callers", async () => {
    const urls = await Promise.all([
      ensureTestDatabase("shared_testing"),
      ensureTestDatabase("shared_testing"),
      ensureTestDatabase("shared_testing"),
    ]);
    expect(new Set(urls).size).toBe(1);
    const client = new pg.Client({ connectionString: urls[0] });
    await client.connect();
    try {
      const { rows } = await client.query<{ db: string }>("SELECT current_database() AS db");
      expect(rows[0]?.db).toBe("turnstile_shared_testing_test");
    } finally {
      await client.end();
    }
  });

  it("explains how to fix an unreachable server", async () => {
    await expect(
      ensureTestDatabase("shared_testing", {
        TEST_DATABASE_ADMIN_URL: "postgres://u:p@127.0.0.1:1/postgres",
      }),
    ).rejects.toThrow(/Cannot reach the test Postgres at 127.0.0.1:1/);
  });
});
