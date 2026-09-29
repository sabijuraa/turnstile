import { ensureTestDatabase } from "@turnstile/shared/testing";

/** Creates turnstile_backend_test on the server named by TEST_DATABASE_ADMIN_URL when missing. */
export default async function setup(): Promise<void> {
  await ensureTestDatabase("backend");
}
