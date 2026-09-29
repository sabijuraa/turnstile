import { ensureTestDatabase } from "@turnstile/shared/testing";

/** Creates turnstile_facilitator_test on the server named by TEST_DATABASE_ADMIN_URL when missing. */
export default async function setup(): Promise<void> {
  await ensureTestDatabase("facilitator");
}
