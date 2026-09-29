import { createPool, migrate } from "./db.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Point it at the Turnstile Postgres database.");
  process.exit(1);
}
const pool = createPool(url, 1);
try {
  const applied = await migrate(pool);
  console.warn(applied.length ? `Applied ${applied.join(", ")}` : "Database is up to date.");
} finally {
  await pool.end();
}
