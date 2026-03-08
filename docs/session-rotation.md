# Session Rotation

Session rotation replaces the current session ID with a new one. This prevents session fixation attacks and is required after privilege escalation (e.g. login).

---

## `rotateId()`

```typescript
await req.session.rotateId()
```

What happens:

1. A new session ID is generated
2. The session data is saved under the new ID
3. The old session entry in the store is updated to `{ data: null, meta: { redirectTo: newId } }`
4. The cookie is updated to the new session ID
5. `req.session.data` continues to point to the new session seamlessly

The old ID remains valid for `rotation.gracePeriod` milliseconds (default: `cookie.ttl`). This handles in-flight parallel requests that still carry the old cookie.

---

## Grace Period & Redirect Chain

When a request arrives with an old session ID that has been rotated, the middleware follows the `redirectTo` chain until it reaches the current active session.

```
Request with old-id
  → store.get('old-id') → { redirectTo: 'new-id' }
    → store.get('new-id') → { data: {...}, meta: {...} }
      → session loaded, cookie updated to 'new-id'
```

As a side effect, intermediate entries in the chain are updated to point directly to the final ID (chain shortcut), so future requests with the same old cookie skip the intermediate hops.

### Chain depth limit

The chain is followed up to a depth of 10. Beyond that, a `SessionDepthError` is thrown (treated as a chain error, triggers `onBrokenChain`).

---

## Broken Chain

If a session in the redirect chain is missing from the store (e.g. expired before the grace period elapsed), a `SessionChainBrokenError` is thrown.

Handle it via the `onBrokenChain` option:

```typescript
sessionMiddleware({
  onBrokenChain: (req, res, next) => {
    res.redirect('/login')
  },
  // ...
})
```

Default: `410 Gone` with `{ error: 'session expired' }`.

---

## `rotation.gracePeriod`

```typescript
sessionMiddleware({
  rotation: {
    gracePeriod: 30_000  // old ID valid for 30 seconds after rotation
  }
})
```

Minimum: `5000` ms. Default: `cookie.ttl`.

A very short grace period risks breaking parallel requests that carry the old cookie. Set it to cover the maximum expected request duration under load.

---

## Rotation on Login (Session Fixation Prevention)

Always rotate after successful authentication:

```typescript
app.post('/login', async (req, res) => {
  const user = await authenticate(req.body)

  req.session.data.userId = user.id
  req.session.data.role = user.role

  await req.session.rotateId()  // new ID, old cookie invalidated
  await req.session.save()

  res.json({ ok: true })
})
```

---

## Rotation and Locks

`rotateId()` cannot be called while the current request holds a lock. It will throw `SessionLockError`. Release the lock first:

```typescript
await req.session.withLock(async () => {
  // ... critical section
})
await req.session.rotateId()  // OK after lock is released
```
