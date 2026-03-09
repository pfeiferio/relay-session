# relay-session

> Modern TypeScript-first session middleware for Express with a Promise-based API. No legacy API, no
`saveUninitialized`, no `resave`.

[![npm version](https://img.shields.io/npm/v/relay-session.svg)](https://www.npmjs.com/package/relay-session)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.15-brightgreen.svg)](https://nodejs.org/)
[![codecov](https://codecov.io/gh/pfeiferio/relay-session/branch/main/graph/badge.svg)](https://codecov.io/gh/pfeiferio/relay-session)

---

## Features

- Dirty-path tracking and partial writes via `merge()`
- HMAC-signed cookies with secret rotation
- Session ID rotation with grace period (session fixation prevention)
- Optional distributed locking
- Near-expiry rolling and graceful shutdown integration

---

## Installation

```bash
npm install relay-session
```

**Peer dependency:** `express ^4 || ^5`

> **Node.js:** Requires `>=18.15.0`. The middleware uses `res.appendHeader()` from Node.js `http.ServerResponse`, which
> was added in v18.15.0.

---

## Quick Start

```typescript
import {sessionMiddleware} from 'relay-session'

app.use(sessionMiddleware<{ userId: string; role: string }>({
  cookie: {
    name: 'sid',
    secret: process.env.SESSION_SECRET!,
    ttl: 60 * 60 * 1000, // 1 hour
  },
}))

app.post('/login', async (req, res) => {
  req.session.data.userId = '123'
  req.session.data.role = 'admin'
  await req.session.rotateId()   // session fixation prevention
  await req.session.save()
  res.json({ok: true})
})
```

---

## Documentation

- [Session Rotation](./docs/session-rotation.md)
- [Session Locking](./docs/locking.md)
- [Store Adapter](./docs/store-adapter.md)
- [Migration from express-session](./docs/migration.md)

---

## Configuration

```typescript
sessionMiddleware<T>(options
:
SessionMiddlewareOptions
):
RequestHandler
```

### `cookie` (required)

| Option         | Type                                    | Default                | Description                                                 |
|----------------|-----------------------------------------|------------------------|-------------------------------------------------------------|
| `name`         | `string`                                | —                      | Cookie name                                                 |
| `secret`       | `string`                                | —                      | HMAC signing secret                                         |
| `oldSecrets`   | `string[]`                              | `[]`                   | Previous secrets for rolling key rotation                   |
| `ttl`          | `number`                                | —                      | Session lifetime in milliseconds (positive integer)         |
| `secure`       | `boolean`                               | `true`                 | Sets `Secure` flag                                          |
| `httpOnly`     | `boolean`                               | `true`                 | Sets `HttpOnly` flag                                        |
| `sameSite`     | `'strict' \| 'lax' \| 'none'`           | `'strict'`             | Sets `SameSite` attribute. `'none'` requires `secure: true` |
| `cookieReader` | `(req, name) => Record<string, string>` | built-in header parser | Custom cookie reader, e.g. for integrating `cookie-parser`  |

### `store`

A `SessionStoreAdapter` instance. Defaults to an ephemeral in-memory store — **not suitable for production** (does not
survive restarts, not shared across processes). See [Store Adapter](#store-adapter).

### `rolling`

Controls when the session cookie is refreshed.

| Value                     | Behavior                                                     |
|---------------------------|--------------------------------------------------------------|
| `true`                    | Refresh the cookie on every request                          |
| `false`                   | Never refresh; cookie expires at its original `expiresAt`    |
| `number` (0–1, exclusive) | Refresh only when remaining lifetime < `(1 - rolling) × ttl` |

A number close to `1` (e.g. `0.9`) refreshes only near expiry. A number close to `0` (e.g. `0.1`) refreshes on almost
every request. New sessions always get their cookie set regardless of this setting.

Default: `true`

### `rotation`

| Option        | Type     | Default      | Description                                                                          |
|---------------|----------|--------------|--------------------------------------------------------------------------------------|
| `gracePeriod` | `number` | `cookie.ttl` | How long the old session ID remains valid after `rotateId()`, in ms. Minimum: `5000` |

See [Session ID Rotation](#session-id-rotation).

### `lock`

| Option    | Type     | Default | Description                                               |
|-----------|----------|---------|-----------------------------------------------------------|
| `ttl`     | `number` | `5000`  | Lock expiry in ms                                         |
| `retries` | `number` | `10`    | Max retry attempts before throwing `SessionLockError`     |
| `backoff` | `number` | `50`    | Base backoff in ms, multiplied linearly by attempt number |

Only relevant when the store implements `lock` / `unlock` / `isLocked`. See [Locking](#locking).

### `autoSave`

`boolean` — default `false`.

When `true`, `save()` is called automatically on the `res.finish` event. Errors are passed to `onAutoSaveError`.
Integrates with `shutdown` to delay process exit until the save completes.

### `signWith`

`(req: Request) => string | string[]` — default `undefined`

Binds the session cookie signature to one or more request-derived values. If the computed value changes between
requests, the cookie is rejected and the client receives a new session.

```typescript
// Bind to User-Agent
signWith: (req) => req.headers['user-agent'] ?? ''

// Bind to IP address
signWith: (req) => req.ip ?? ''

// Bind to multiple values
signWith: (req) => [
  req.headers['user-agent'] ?? '',
  req.ip ?? ''
]
```

**Before enabling, consider:**

- Any change in the bound value invalidates the session — including browser updates, IP changes (mobile networks, VPNs),
  and proxy normalization
- In-app browsers and WebViews frequently change their `User-Agent`
- IP binding is unreliable for mobile users who switch between WiFi and cellular

Only enable this in controlled environments where the bound values are stable across requests.

### `debug`

`boolean | ((msg: string) => void)` — default `false`.

Set to `true` to log to `console.debug`, or pass a custom logger. Each log line is prefixed with a per-request
correlation ID.

### `shutdown`

| Option        | Type               | Default | Description                                                                                   |
|---------------|--------------------|---------|-----------------------------------------------------------------------------------------------|
| `registry`    | `ShutdownRegistry` | —       | From [`request-drain`](https://github.com/pfeiferio/request-drain). Tracks in-flight requests |
| `waitTimeout` | `number`           | `30000` | Max ms to wait for in-flight saves during shutdown                                            |

When `registry` is provided, the middleware registers itself and delays process exit until all pending `autoSave`
operations have completed.

### `onBrokenChain`

`RequestHandler` — default: `(req, res) => res.status(410).json({ error: 'session expired' })`

Called when a session rotation redirect chain leads to a target that no longer exists in the store (e.g. the old session
expired before `gracePeriod`).

### `onAutoSaveError`

`(err: unknown, req: Request) => void` — default: `console.error`

Called when `autoSave` fails. Does not affect the response.

### `onUnlockError`

`(err: unknown, req: Request) => void` — default: `console.error`

Called when the automatic unlock on request close fails (e.g. store unreachable).

---

## Session API

All properties and methods are available on `req.session`.

### Properties

| Property       | Type      | Description                                                    |
|----------------|-----------|----------------------------------------------------------------|
| `id`           | `string`  | Current session ID                                             |
| `data`         | `T`       | Session data (Proxy — dirty-tracked)                           |
| `isNew`        | `boolean` | `true` if the session was just created in this request         |
| `isRedirected` | `boolean` | `true` if the session was loaded via a rotation redirect chain |
| `isLockOwner`  | `boolean` | `true` if this request currently holds the session lock        |
| `createdAt`    | `number`  | Unix timestamp (ms) when the session was created               |
| `expiresAt`    | `number`  | Unix timestamp (ms) when the session will expire               |

### Methods

```typescript
declare class Session<T> {
  /** Current session ID */
  readonly id: string
  /** Session data (Proxy — dirty-tracked) */
  readonly data: T
  /** `true` if the session was just created in this request */
  readonly isNew: boolean
  /** `true` if the session was loaded via a rotation redirect chain */
  readonly isRedirected: boolean
  /** `true` if this request currently holds the session lock */
  readonly isLockOwner: boolean
  /** Unix timestamp (ms) when the session was created */
  readonly createdAt: number
  /** Unix timestamp (ms) when the session will expire */
  readonly expiresAt: number
  /** The raw proxied store object */
  readonly raw: SessionRawData<T>

  /** Persist dirty changes to the store. Skipped entirely if nothing changed. */
  save(): Promise<void>

  /** Delete session from store, then create a fresh empty session on req.session. */
  destroy(): Promise<void>

  /** Rotate the session ID (session fixation prevention). See Session ID Rotation. */
  rotateId(): Promise<void>

  /** Extend the session's expiry by ttl ms from now. */
  maxAge(ttl: number): this

  /** Acquire an exclusive lock via the store. */
  lock(): Promise<void>

  /** Release the exclusive lock. Returns true if released, false if this request was not the lock owner. */
  unlock(): Promise<boolean>

  /** Convenience: acquire lock, run fn, release lock — even on error. */
  withLock<R>(fn: () => R | Promise<R>): Promise<R>

  /** Dirty-path inspection. Useful for custom save strategies. */
  getDirtyPaths(): Set<string>

  /** Clear all dirty paths without saving. */
  clearDirty(): void
}
```

---

## TypeScript

Pass your session data type as a generic for full type safety:

```typescript
type SessionData = {
  auth: { userId: string; tokens: TokenResponse }
  preferences: { theme: 'light' | 'dark' }
}

app.use(sessionMiddleware<SessionData>({...}))

// req.session.data is fully typed
req.session.data.auth.userId       // string
req.session.data.preferences.theme // 'light' | 'dark'
```

In route handlers where the generic is not carried through, use `assertSession` to narrow the type:

```typescript
import {assertSession} from 'relay-session'

app.get('/profile', (req, res) => {
  assertSession<SessionData>(req.session)
  // req.session.data is now SessionData
  res.json({user: req.session.data.auth.userId})
})
```

`assertSession` is a no-op at runtime — it only narrows the TypeScript type.

### Global Type Augmentation
For a cleaner developer experience, you can define your session types globally. This removes the need to pass generics
to sessionMiddleware or assertSession throughout your application:

```typescript
// types/session.d.ts
declare module 'relay-session' {
  interface SessionData {
    userId: string;
    role: 'admin' | 'user';
    cart: { items: string[] };
  }
}

// Now req.session.data is automatically typed
app.get('/dashboard', (req, res) => {
  if (req.session.data.role === 'admin') {
    // ...
  }
});
```

---

## Dirty Tracking

`req.session.data` is a recursive Proxy that tracks which dot-paths have been mutated. `save()` uses this to write only
what changed.

```typescript
req.session.data.user = {name: 'Pascal'}  // marks 'data.user'
req.session.data.user.name = 'Max'          // marks 'data.user.name' (collapses parent)
req.session.data.items.push('x')            // marks 'data.items' (whole array dirty)

await req.session.save()  // writes only dirty paths
```

If no paths are dirty, `save()` is a no-op.

> **Proxy identity:** Because `data` is a recursive Proxy, comparing nested objects with `===` may yield `false` even
> for the same logical value. Avoid reference-equality checks on objects retrieved from `session.data`.

**With `merge()`:** If the store implements `merge()`, only the dirty dot-paths are sent to the store atomically.

**Without `merge()`:** The middleware re-reads the current session from the store, merges dirty paths in-memory, and
writes the complete result back.

---

## Secret Rotation

Roll your signing secret without invalidating existing sessions:

```typescript
sessionMiddleware({
  cookie: {
    secret: 'new-secret',
    oldSecrets: ['previous-secret', 'even-older-secret'],
  }
})
```

Incoming cookies are verified against `secret` first, then each entry in `oldSecrets` in order. New cookies are always
signed with `secret`. Remove old secrets once all existing sessions have naturally expired.

---

## Session ID Rotation

`rotateId()` creates a new session ID and writes the data under it, then converts the old ID into a redirect pointer
valid for `gracePeriod` ms. This prevents session fixation attacks and should be called after privilege changes (e.g.
login).

```typescript
app.post('/login', async (req, res) => {
  req.session.data.userId = user.id
  await req.session.rotateId()  // old cookie → redirects to new ID
  await req.session.save()
  res.json({ok: true})
})
```

Concurrent requests using the old cookie are transparently forwarded to the new session during the grace period. The
middleware follows redirect chains up to a depth of 10; beyond that, `onBrokenChain` is called.

```typescript
sessionMiddleware({
  rotation: {
    gracePeriod: 30_000  // 30s; defaults to cookie.ttl; minimum 5000
  }
})
```

---

## Locking

Session locking prevents race conditions when multiple concurrent requests modify the same session. Locking is opt-in:
the store must implement `lock`, `unlock`, and `isLocked`. All three must be implemented together.

```typescript
// Acquire an exclusive lock before sensitive operations
app.post('/checkout', async (req, res) => {
  await req.session.withLock(async () => {
    if (req.session.data.balance < amount) throw new Error('Insufficient funds')
    req.session.data.balance -= amount
    await req.session.save()
  })
  res.json({ok: true})
})
```

A held lock is automatically released when the request closes, even if `unlock()` was never called explicitly.

If `lock()` cannot be acquired within `lock.retries` attempts, a `SessionLockError` is thrown.

**Retry behavior:** Each attempt waits `backoff × attempt` ms. With defaults (`retries: 10`, `backoff: 50`), total wait
before error is at most `50 + 100 + ... + 500 = 2750 ms`.

When `save()` is called without holding the lock, the middleware calls `waitForUnlock()` internally before writing.

---

## Store Adapter

Implement `SessionStoreAdapter` to connect any backend:

```typescript
import type {SessionStoreAdapter, SessionStoreData} from 'relay-session'

const store: SessionStoreAdapter = {
  async get(sessionId: string): Promise<SessionStoreData | null> {
    // Return the stored data, or null if not found / expired
  },

  async set(sessionId: string, data: SessionStoreData, ttlMs: number): Promise<void> {
    // Persist data with the given TTL
  },

  async delete(sessionId: string): Promise<void> {
    // Remove the session
  },

  // Optional: atomic partial update. Receives dirty dot-paths and their new values.
  // If omitted, the middleware uses get() + set() with in-memory merge.
  async merge(sessionId: string, paths: Record<string, unknown>, ttlMs: number): Promise<void> {
    // Apply paths to stored data atomically
  },

  // Optional locking — must implement all three or none.
  // lock() MUST be atomic (check-and-set in one operation).
  async lock(sessionId: string, ttlMs: number): Promise<boolean> {
    // Return true if lock was acquired, false if already locked
  },
  async unlock(sessionId: string): Promise<void> {
  },
  async isLocked(sessionId: string): Promise<boolean> {
  },
}
```

All methods may return `Promise<T>` or `T` directly.

---

## Adapters

A Redis store adapter is available as a separate package: [
`relay-session-redis`](https://www.npmjs.com/package/relay-session-redis)

### Built-in: `createInMemoryStorage`

```typescript
import {createInMemoryStorage} from 'relay-session'

sessionMiddleware({
  store: createInMemoryStorage(),
  // ...
})
```

Implements all adapter methods including locking. Suitable for local development and single-process testing only.

---

## Error Types

All error classes and type guards are exported.

| Class                     | Guard                       | Description                                          |
|---------------------------|-----------------------------|------------------------------------------------------|
| `SessionConfigError`      | `isSessionConfigError`      | Invalid middleware configuration (thrown at startup) |
| `SessionChainError`       | `isSessionChainError`       | Base class for rotation chain errors                 |
| `SessionChainBrokenError` | `isSessionChainBrokenError` | Redirect chain target not found in store             |
| `SessionDepthError`       | `isSessionDepthError`       | Redirect chain exceeded max depth (10)               |
| `SessionLockError`        | `isSessionLockError`        | Lock could not be acquired within the retry budget   |

`SessionChainBrokenError` and `SessionDepthError` extend `SessionChainError`. Both are handled internally by calling
`onBrokenChain` — they do not reach the Express error handler.

```typescript
import {isSessionLockError} from 'relay-session'

app.use((err, req, res, next) => {
  if (isSessionLockError(err)) {
    return res.status(409).json({error: 'concurrent request conflict'})
  }
  next(err)
})
```

---

## Graceful Shutdown

Integrate with [`request-drain`](https://github.com/pfeiferio/request-drain) to delay process exit until all in-flight
`autoSave` operations have completed:

```typescript
import {ShutdownRegistry} from 'request-drain'

const shutdownRegistry = new ShutdownRegistry()

app.use(sessionMiddleware({
  autoSave: true,
  shutdown: {
    registry: shutdownRegistry,
    waitTimeout: 30_000,
  },
  // ...
}))

process.on('SIGTERM', async () => {
  await shutdownRegistry.shutdown()
  process.exit(0)
})
```
