// Exits 0 when the given URL answers with a 2xx status within the timeout.
// Used by container healthchecks, so it needs nothing beyond Node itself.
const url = process.argv[2];
const timeoutMs = Number(process.argv[3] ?? "3000");
if (!url) {
  console.error("Pass the URL to check, for example http://127.0.0.1:4020/readyz");
  process.exit(2);
}
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    console.error(`${url} answered ${res.status}`);
    process.exit(1);
  }
} catch (err) {
  console.error(`${url} did not answer: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
