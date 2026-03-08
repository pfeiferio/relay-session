# Migration Guide — Coming from `express-session`

This guide covers the key differences between `express-session` and `relay-session`.

---

## Session Data

`express-session` stores data directly on `req.session`:

```typescript
req.session.userId = '123'
req.session.role = 'admin'
```

Here, session data lives under `req.session.data`:

```typescript
req.session.data.userId = '123'
req.session.data.role = 'admin'
```

---

## Saving Sessions

`express-session` has `saveUninitialized` and `resave` options that control when sessions are persisted automatically.

This middleware has neither. Saving is explicit — call `save()` yourself, or enable `autoSave`:

```typescript
// Explicit
await req.session.save()

// Automatic on response finish
sessionMiddleware({ autoSave: true, ... })
```

If nothing has changed, `save()` is a no-op — no unnecessary writes.

---

## Session ID Rotation

`express-session` has no built-in session fixation prevention. You typically call `req.session.regenerate()`.

Here, use `rotateId()`. The old ID remains valid for `gracePeriod` ms and transparently redirects concurrent requests
to the new session — no dropped requests during rotation:

```typescript
// express-session
req.session.regenerate((err) => {
  req.session.userId = user.id
  req.session.save(callback)
})

// relay-session
await req.session.rotateId()
req.session.data.userId = user.id
await req.session.save()
```

---

## Destroying Sessions

```typescript
// express-session
req.session.destroy(callback)

// relay-session
await req.session.destroy()
```

After `destroy()`, a fresh empty session is created automatically on `req.session` — no need to handle the empty state
manually.

---

## Store Adapter

`express-session` stores implement a specific interface with callbacks. This middleware uses a Promise-based
(or sync) interface:

```typescript
// express-session store (callback-based)
store.get(sid, callback)
store.set(sid, session, callback)
store.destroy(sid, callback)

// relay-session store (Promise-based)
store.get(sessionId)   // Promise<SessionStoreData | null> | SessionStoreData | null
store.set(sessionId, data, ttlMs)
store.delete(sessionId)
```

Existing `express-session` stores are not compatible and need to be replaced or wrapped.

---

## TypeScript

`express-session` requires module augmentation to type session data:

```typescript
declare module 'express-session' {
  interface SessionData {
    userId: string
  }
}
```

Here, pass the type as a generic directly:

```typescript
app.use(sessionMiddleware<{ userId: string }>({ ... }))

// req.session.data is fully typed — no augmentation needed
req.session.data.userId
```

---

## Key Differences at a Glance

| | `express-session` | `relay-session` |
|---|---|---|
| Session data | `req.session.foo` | `req.session.data.foo` |
| Saving | `resave`, `saveUninitialized` | explicit `save()` or `autoSave` |
| ID rotation | `regenerate()` with callback | `rotateId()` with grace period |
| Store interface | callback-based | Promise-based |
| TypeScript | module augmentation | generic `sessionMiddleware<T>` |
| Dirty tracking | full write every time | partial writes via dirty paths |
| Locking | not built-in | optional, store-backed |
