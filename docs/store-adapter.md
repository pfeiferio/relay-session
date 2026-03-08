# Store Adapter

The store adapter is the persistence layer. Implement the `SessionStoreAdapter` interface to connect any backend.

---

## Interface

```typescript
interface SessionStoreAdapter {
  // Required
  get(sessionId: string): Promise<SessionStoreData | null> | SessionStoreData | null
  set(sessionId: string, data: SessionStoreData, ttlMs: number): Promise<void> | void
  delete(sessionId: string): Promise<void> | void

  // Optional — atomic partial writes (e.g. Redis HSET)
  merge?(sessionId: string, paths: Record<string, unknown>, ttlMs: number): Promise<void> | void

  // Optional — distributed locking
  lock?(sessionId: string, ttlMs: number): Promise<boolean> | boolean
  unlock?(sessionId: string): Promise<void> | void
  isLocked?(sessionId: string): Promise<boolean> | boolean
}
```

All methods can be sync or async.

---

## `SessionStoreData`

The data passed to `set` / returned by `get` is one of two shapes:

**Active session:**
```typescript
{
  data: Record<string, unknown>  // your session data
  meta: {
    id: string
    createdAt: number
    expiresAt: number
    redirectTo?: string          // set during rotation
  }
}
```

**Rotation redirect (expired session pointing to new ID):**
```typescript
{
  data: null
  meta: {
    redirectTo: string           // new session ID
  }
}
```

---

## `merge()` — Atomic Partial Writes

When implemented, `merge` receives only the changed dot-paths instead of the full session object. This enables atomic partial updates (e.g. Redis `HSET`) and avoids last-write-wins data loss for concurrent requests writing to different fields.

```typescript
// paths example:
{
  'data.user.name': 'Pascal',
  'data.cart': [1, 2, 3]
}
```

If `merge` is not implemented, the middleware falls back to a read-modify-write cycle using `set`.

---

## `lock()` / `unlock()` / `isLocked()`

Used for explicit critical sections via `req.session.lock()`. See [Locking →](./locking.md)

`lock()` **must be atomic** — check and acquire in a single operation. For Redis this means `SET key NX PX ttl`.

Returns `true` if the lock was acquired, `false` if already locked.

---

## In-Memory Store (built-in)

The default store. For development and testing only — data is lost on process restart and not shared across instances.

```typescript
import { createInMemoryStorage } from 'relay-session'

const store = createInMemoryStorage()
```

Supports `get`, `set`, `delete`, `merge`, `lock`, `unlock`.

TTL is enforced lazily on `get` — no background expiry timer.

---

## Custom Store Example

```typescript
import type { SessionStoreAdapter, SessionStoreData } from 'relay-session'
import { Redis } from 'ioredis'

const redis = new Redis()
const PREFIX = 'sess:'

export const redisStore: SessionStoreAdapter = {
  async get(sessionId) {
    const raw = await redis.get(PREFIX + sessionId)
    if (!raw) return null
    return JSON.parse(raw) as SessionStoreData
  },

  async set(sessionId, data, ttlMs) {
    await redis.set(PREFIX + sessionId, JSON.stringify(data), 'PX', ttlMs)
  },

  async delete(sessionId) {
    await redis.del(PREFIX + sessionId)
  },

  // Optional: atomic field-level writes
  async merge(sessionId, paths, ttlMs) {
    const current = await this.get(sessionId) ?? { data: {}, meta: {} }
    // apply paths to current ... (use @pfeiferio/dotpath-utils or similar)
    await this.set(sessionId, current as SessionStoreData, ttlMs)
  },

  // Optional: distributed lock
  async lock(sessionId, ttlMs) {
    const result = await redis.set(PREFIX + 'lock:' + sessionId, '1', 'NX', 'PX', ttlMs)
    return result === 'OK'
  },

  async unlock(sessionId) {
    await redis.del(PREFIX + 'lock:' + sessionId)
  },

  async isLocked(sessionId) {
    return await redis.exists(PREFIX + 'lock:' + sessionId) === 1
  },
}
```
