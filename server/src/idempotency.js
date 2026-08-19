/**
 * Very small idempotency layer.
 *
 * The mobile client retries failed requests (network drop, timeout) using
 * exponential backoff, reusing the same traceId as an Idempotency-Key across
 * attempts. Without this, a client-side timeout on a request that actually
 * succeeded server-side would cause the LLM to be called again — wasted cost,
 * and a real risk of the same photo/text producing two slightly different
 * results if the model isn't perfectly deterministic.
 *
 * This is intentionally simple: an in-memory Map with a TTL. It resets on
 * every server restart, which matters on Render's free tier (the process
 * sleeps and cold-starts after inactivity) — fine for a demo, called out as
 * a known limitation in the README. In production this would be Redis (or
 * any shared cache) so it survives restarts and works across replicas.
 */
const TTL_MS = 5 * 60 * 1000; // 5 minutes — long enough to cover our own retry loop
const store = new Map();

function cleanupExpired() {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt < now) store.delete(key);
  }
}

/**
 * Wraps a handler so that the same Idempotency-Key returns the same result
 * without re-running fn(), for TTL_MS. Concurrent requests with the same key
 * share a single in-flight promise so they don't race each other into
 * calling the LLM twice either.
 */
async function withIdempotency(key, fn) {
  if (!key) return fn(); // no key provided — behave like a normal call

  cleanupExpired();
  const existing = store.get(key);
  if (existing) {
    return existing.promise;
  }

  const promise = fn().catch((err) => {
    // Don't cache failures — a genuinely failed attempt should be retryable
    // immediately, not stuck returning the same error for 5 minutes.
    store.delete(key);
    throw err;
  });

  store.set(key, { promise, expiresAt: Date.now() + TTL_MS });
  return promise;
}

module.exports = { withIdempotency };
