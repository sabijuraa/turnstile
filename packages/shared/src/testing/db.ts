import pg from "pg";

/**
 * Test database convention for every package.
 *
 * TEST_DATABASE_ADMIN_URL points at a role that may create databases. Each package gets its
 * own database named turnstile_<pkg>_test on that server, so suites that run in parallel never
 * share tables. The default is the compose Postgres on port 5433.
 */
export const DEFAULT_TEST_DATABASE_ADMIN_URL =
  "postgres://turnstile:turnstile@127.0.0.1:5433/postgres";

const PACKAGE_NAME = /^[a-z][a-z0-9_]{0,40}$/;

export function testDatabaseAdminUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.TEST_DATABASE_ADMIN_URL || DEFAULT_TEST_DATABASE_ADMIN_URL;
}

export function testDatabaseName(pkg: string): string {
  if (!PACKAGE_NAME.test(pkg)) {
    throw new Error(
      `Test database key "${pkg}" is not valid. Use lower case letters, digits and underscores.`,
    );
  }
  return `turnstile_${pkg}_test`;
}

/** The URL of the package's test database. Does not create it. */
export function testDatabaseUrl(pkg: string, env: NodeJS.ProcessEnv = process.env): string {
  const url = new URL(testDatabaseAdminUrl(env));
  url.pathname = `/${testDatabaseName(pkg)}`;
  return url.toString();
}

/** Creates the package's test database when it does not exist yet and returns its URL. */
export async function ensureTestDatabase(
  pkg: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const name = testDatabaseName(pkg);
  const adminUrl = testDatabaseAdminUrl(env);
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
  } catch (err) {
    const where = new URL(adminUrl);
    throw new Error(
      `Cannot reach the test Postgres at ${where.host}. Start it with 'pnpm dev:up' or set TEST_DATABASE_ADMIN_URL. ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (found.rowCount === 0) {
      try {
        await client.query(`CREATE DATABASE ${name}`);
      } catch (err) {
        // Another suite created it between the check and the create.
        const code = (err as { code?: string }).code;
        if (code !== "42P04" && code !== "23505") throw err;
      }
    }
  } finally {
    await client.end();
  }
  return testDatabaseUrl(pkg, env);
}
