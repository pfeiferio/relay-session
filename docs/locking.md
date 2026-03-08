# Session Locking

Locking is optional and only needed for critical sections where concurrent requests must not interleave writes to the same session fields.

For most use cases, dirty-path tracking + optimistic locking light (read-modify-write on `save`) is sufficient.

---

## When to Use Locking

**Not needed:**
- Normal session reads and writes (dirty tracking handles concurrent requests on different paths)
- Login / logout flows

**Needed:**
- Token refresh: check if token is expired, refresh it, store new token — must be atomic
- Balance operations, counters where Last-Write-Wins is unacceptable

---

## API

```typescript
await req.session.lock()                   // acquire exclusive lock
const released = await req.session.unlock() // release lock — true if released, false if not the owner

const result = await req.session.withLock(async () => {
  // critical section
  return result
})

req.session.isLockOwner                    // boolean — whether this request holds the lock
```

If the lock cannot be acquired within `lock.retries` attempts, a `SessionLockError` is thrown.

---

## Configuration

```typescript
sessionMiddleware({
  lock: {
    ttl: 30_000,    // lock expiry in ms (safety net for crashed requests)
    retries: 10,    // max acquire attempts
    backoff: 50,    // base backoff in ms — attempt N waits N * backoff ms
  }
})
```

Backoff is linear: attempt 1 = 50ms, attempt 2 = 100ms, ..., attempt 10 = 500ms.

---

## Save Behaviour Under Lock

A `save()` call from the lock owner skips the "wait for unlock" check — it proceeds immediately. Other concurrent requests calling `save()` on the same session will wait for the lock to be released before writing.

---

## Auto-Unlock on Response Close

If the request ends while still holding the lock (e.g. unhandled throw), the middleware automatically calls `unlock()` on `res.close`. This prevents indefinitely locked sessions when `lock.ttl` has not yet expired.

---

## Implementing Lock in a Store

`lock()` **must be atomic** — the check and the set must happen in a single operation. Without atomicity, two concurrent requests can both see "not locked" and both acquire the lock.

**Redis:**
```typescript
async lock(sessionId, ttlMs) {
  // SET ... NX PX is atomic — only one request can succeed
  const result = await redis.set(`lock:${sessionId}`, '1', 'NX', 'PX', ttlMs)
  return result === 'OK'
}
```

**In-process (built-in memory store):**
The in-memory store uses a simple `locks` map. This is safe within a single Node.js process (single-threaded), but does not work across multiple instances.

---

## Example: Token Refresh

```typescript
import type { Session } from 'relay-session'

app.use('/api', async (req, res, next) => {
  const session = req.session as Session<{ auth: { accessToken: string; expiresAt: number } }>

  if (session.data.auth.expiresAt < Date.now()) {
    await session.withLock(async () => {
      // Re-read inside the lock — another request may have already refreshed
      if (session.data.auth.expiresAt < Date.now()) {
        const refreshed = await refreshAccessToken(session.data.auth.accessToken)
        session.data.auth.accessToken = refreshed.accessToken
        session.data.auth.expiresAt = refreshed.expiresAt
        await session.save()
      }
    })
  }

  next()
})
```
