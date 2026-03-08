import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {sessionMiddleware} from '../dist/session-middleware/sessionMiddleware.js'
import {createInMemoryStorage} from '../dist/utils/createInMemoryStorage.js'

const SECRET = 'test-secret'
const COOKIE_NAME = 'sid'
const TTL = 60_000

function signCookie(sessionId, secret = SECRET) {
  const sig = crypto.createHmac('sha256', secret).update(sessionId).digest('base64url')
  return `${sessionId}.${sig}`
}

function makeSimpleStore(initial = {}) {
  const entries = {...initial}
  return {
    get: async (id) => entries[id] ?? null,
    set: async (id, data) => {
      entries[id] = data
    },
    delete: async (id) => {
      delete entries[id]
    },
    _entries: entries,
  }
}

function makeReq(signedCookieValue = null) {
  const listeners = {}
  const req = {
    headers: signedCookieValue
      ? {cookie: `${COOKIE_NAME}=${encodeURIComponent(signedCookieValue)}`}
      : {},
    on(event, fn) {
      listeners[event] = fn
    },
    _emit(event) {
      listeners[event]?.()
    },
    session: undefined,
  }
  return req
}

function makeRes() {
  const listeners = {}
  const res = {
    cookies: [],
    on(event, fn) {
      listeners[event] = fn
    },
    appendHeader(name, value) {
      if (name === 'Set-Cookie') res.cookies.push(value)
    },
    writableEnded: false,
    status() {
      return res
    },
    json() {
      return res
    },
  }
  return res
}

function getCookieValue(res) {
  const header = res.cookies.find(h => h.startsWith(`${COOKIE_NAME}=`))
  if (!header) return null
  return decodeURIComponent(header.split(';')[0].split('=').slice(1).join('='))
}

async function run(mw, req, res = makeRes()) {
  let nextErr
  await mw(req, res, (err) => {
    nextErr = err
  })
  return {req, res, nextErr}
}

function createMiddleware(overrides = {}) {
  const store = overrides.store ?? makeSimpleStore()
  const mw = sessionMiddleware({
    cookie: {
      name: COOKIE_NAME,
      secret: SECRET,
      ttl: TTL,
      secure: false,
      sameSite: 'lax',
      httpOnly: false, ...(overrides.cookie ?? {})
    },
    store,
    rolling: overrides.rolling ?? false,
    autoSave: false,
    onBrokenChain: overrides.onBrokenChain ?? ((_req, res) => res.status(410).json({})),
    ...(overrides.signWith ? {signWith: overrides.signWith} : {}),
    ...(overrides.debug ? {debug: overrides.debug} : {}),
  })
  return {mw, store}
}

function makeSessionEntry(id, data = {}, opts = {}) {
  return {
    data,
    meta: {
      id,
      createdAt: Date.now(),
      expiresAt: Date.now() + TTL,
      ...(opts.redirectTo ? {redirectTo: opts.redirectTo} : {}),
    },
  }
}

// ─────────────────────────────────────────────
describe('Session', () => {

  describe('raw', () => {
    it('returns the proxied raw session data', async () => {
      const {mw} = createMiddleware()
      const req = makeReq()
      await run(mw, req)

      const raw = req.session.raw
      assert.ok(raw, 'raw should be defined')
      assert.ok(raw.meta, 'raw.meta should exist')
      assert.strictEqual(raw.meta.id, req.session.id)
    })
  })

  // ─────────────────────────────────────────────
  describe('withLock()', () => {
    it('acquires the lock, runs the function, and releases it', async () => {
      const {mw, store: baseStore} = createMiddleware()
      const lockCalls = []
      const unlockCalls = []

      const store = {
        ...baseStore,
        lock: async (id, ttl) => {
          lockCalls.push(id);
          return true
        },
        unlock: async (id) => {
          unlockCalls.push(id)
        },
        isLocked: async () => false,
      }
      const mw2 = sessionMiddleware({
        cookie: {name: COOKIE_NAME, secret: SECRET, ttl: TTL, secure: false, sameSite: 'lax', httpOnly: false},
        store,
        rolling: false,
        autoSave: false,
        onBrokenChain: (_req, res) => res.status(410).json({}),
      })

      const req = makeReq()
      await run(mw2, req)

      let lockedDuring = false
      await req.session.withLock(async () => {
        lockedDuring = req.session.isLockOwner
      })

      assert.ok(lockedDuring, 'should be lock owner during fn execution')
      assert.strictEqual(req.session.isLockOwner, false, 'should be unlocked after withLock')
      assert.ok(lockCalls.includes(req.session.id))
      assert.ok(unlockCalls.includes(req.session.id))
    })

    it('releases the lock even when the function throws', async () => {
      const store = {
        get: async () => null,
        set: async () => {
        },
        delete: async () => {
        },
        lock: async () => true,
        unlock: async () => {
        },
        isLocked: async () => false,
      }
      const mw = sessionMiddleware({
        cookie: {name: COOKIE_NAME, secret: SECRET, ttl: TTL, secure: false, sameSite: 'lax', httpOnly: false},
        store,
        rolling: false,
        autoSave: false,
        onBrokenChain: (_req, res) => res.status(410).json({}),
      })
      const req = makeReq()
      await run(mw, req)

      await assert.rejects(
        () => req.session.withLock(async () => {
          throw new Error('fn error')
        }),
        /fn error/
      )
      assert.strictEqual(req.session.isLockOwner, false, 'should be unlocked after throw')
    })
  })

  // ─────────────────────────────────────────────
  describe('rotateId()', () => {
    it('sets raw.meta.redirectTo to a new unique session ID', async () => {
      const {mw} = createMiddleware()
      const req = makeReq()
      await run(mw, req)

      const oldId = req.session.id
      await req.session.rotateId()

      const newId = req.session.raw.meta.redirectTo
      assert.ok(newId, 'redirectTo should be set after rotation')
      assert.notStrictEqual(newId, oldId, 'new ID should differ from old ID')
    })

    it('updates the Set-Cookie header immediately with the new session ID', async () => {
      const {mw} = createMiddleware()
      const req = makeReq()
      const res = makeRes()
      await run(mw, req, res)

      const cookiesCountBefore = res.cookies.length
      await req.session.rotateId()

      assert.strictEqual(res.cookies.length, cookiesCountBefore + 1, 'Set-Cookie should be added after rotateId')

      const newId = req.session.raw.meta.redirectTo
      const cookieValue = decodeURIComponent(res.cookies.at(-1).split(';')[0].split('=').slice(1).join('='))
      assert.ok(cookieValue.startsWith(newId + '.'), 'cookie should be signed with the new session ID')
    })

    it('after save(), the old session entry in the store points to the new ID', async () => {
      const {mw, store} = createMiddleware()
      const req = makeReq()
      await run(mw, req)

      const oldId = req.session.id
      req.session.data.user = 'bob'
      await req.session.save()

      await req.session.rotateId()
      const newId = req.session.raw.meta.redirectTo

      // save() triggers updatePreviousSession, storing old → redirectTo: newId
      await req.session.save()

      const oldEntry = await store.get(oldId)
      assert.ok(oldEntry, 'old session entry should exist')
      assert.strictEqual(oldEntry.meta?.redirectTo, newId)
    })
  })

  // ─────────────────────────────────────────────
  describe('lock() / unlock()', () => {
    it('lock() makes the session the lock owner', async () => {
      const store = {
        get: async () => null,
        set: async () => {
        },
        delete: async () => {
        },
        lock: async () => true,
        unlock: async () => {
        },
        isLocked: async () => false,
      }
      const mw = sessionMiddleware({
        cookie: {name: COOKIE_NAME, secret: SECRET, ttl: TTL, secure: false, sameSite: 'lax', httpOnly: false},
        store,
        rolling: false,
        autoSave: false,
        onBrokenChain: (_req, res) => res.status(410).json({}),
      })
      const req = makeReq()
      await run(mw, req)

      assert.strictEqual(req.session.isLockOwner, false)
      await req.session.lock()
      assert.strictEqual(req.session.isLockOwner, true)
      await req.session.unlock()
      assert.strictEqual(req.session.isLockOwner, false)
    })
  })

  // ─────────────────────────────────────────────
  describe('maxAge()', () => {
    it('updates the session expiresAt', async () => {
      const {mw} = createMiddleware()
      const req = makeReq()
      await run(mw, req)

      const before = req.session.expiresAt
      req.session.maxAge(30_000)
      // expiresAt should now be ~30s from now, not ~60s
      assert.ok(req.session.expiresAt < before, 'expiresAt should decrease after maxAge(smaller value)')
    })
  })

  // ─────────────────────────────────────────────
  describe('signWith option', () => {
    it('signs and verifies the cookie with a custom signWith function', async () => {
      const {mw, store} = createMiddleware({
        signWith: (req) => req.headers['x-user-id'] ?? '',
      })

      // First request: create session with user context
      const req1 = makeReq()
      req1.headers['x-user-id'] = 'user-abc'
      const {res: res1} = await run(mw, req1)
      req1.session.data.value = 'secret'
      await req1.session.save()

      // Same user: should load session
      const req2 = makeReq(getCookieValue(res1))
      req2.headers['x-user-id'] = 'user-abc'
      await run(mw, req2)
      assert.strictEqual(req2.session.isNew, false)
      assert.strictEqual(req2.session.data.value, 'secret')

      // Different user: cookie verification fails → new session
      const req3 = makeReq(getCookieValue(res1))
      req3.headers['x-user-id'] = 'user-xyz'
      await run(mw, req3)
      assert.strictEqual(req3.session.isNew, true)
    })
  })

  // ─────────────────────────────────────────────
  describe('toJSON()', () => {
    it('returns an object with raw, isRedirected, and isNew', async () => {
      const {mw} = createMiddleware()
      const req = makeReq()
      await run(mw, req)

      const json = req.session.toJSON()
      assert.ok(typeof json === 'object' && json !== null)
      assert.ok('raw' in json)
      assert.ok('isRedirected' in json)
      assert.ok('isNew' in json)
      assert.strictEqual(json.isNew, true)
      assert.strictEqual(json.isRedirected, false)
    })
  })

  // ─────────────────────────────────────────────
  describe('createdAt', () => {
    it('returns the session creation timestamp', async () => {
      const {mw} = createMiddleware()
      const req = makeReq()
      const before = Date.now()
      await run(mw, req)

      assert.ok(typeof req.session.createdAt === 'number')
      assert.ok(req.session.createdAt >= before)
      assert.ok(req.session.createdAt <= Date.now())
    })

    it('sets createdAt in constructor when raw meta.createdAt is falsy (0)', async () => {
      const sessionId = 'my-session-id'
      const store = makeSimpleStore({
        [sessionId]: {data: {}, meta: {id: sessionId, createdAt: 0, expiresAt: Date.now() + TTL}},
      })
      const {mw} = createMiddleware({store})
      const req = makeReq(signCookie(sessionId))
      const before = Date.now()
      await run(mw, req)

      assert.ok(req.session.createdAt >= before, 'constructor should backfill createdAt when it is 0')
    })
  })

  // ─────────────────────────────────────────────
  describe('isRedirected', () => {
    it('is true when the session was loaded via a redirect chain', async () => {
      const oldId = 'session-old'
      const newId = 'session-new'
      const store = makeSimpleStore({
        [oldId]: makeSessionEntry(oldId, {}, {redirectTo: newId}),
        [newId]: makeSessionEntry(newId, {user: 'alice'}),
      })
      const {mw} = createMiddleware({store})
      const req = makeReq(signCookie(oldId))
      await run(mw, req)

      assert.strictEqual(req.session.isRedirected, true)
      assert.strictEqual(req.session.data.user, 'alice')
    })

    it('is false for a fresh session', async () => {
      const {mw} = createMiddleware()
      const req = makeReq()
      await run(mw, req)
      assert.strictEqual(req.session.isRedirected, false)
    })
  })

  // ─────────────────────────────────────────────
  describe('lock() when already lock owner', () => {
    it('does not call tryLock again when already the lock owner', async () => {
      let lockCallCount = 0
      const store = {
        get: async () => null,
        set: async () => {
        },
        delete: async () => {
        },
        lock: async () => {
          lockCallCount++;
          return true
        },
        unlock: async () => {
        },
        isLocked: async () => false,
      }
      const mw = sessionMiddleware({
        cookie: {name: COOKIE_NAME, secret: SECRET, ttl: TTL, secure: false, sameSite: 'lax', httpOnly: false},
        store,
        rolling: false,
        autoSave: false,
        onBrokenChain: (_req, res) => res.status(410).json({}),
      })
      const req = makeReq()
      await run(mw, req)

      await req.session.lock()
      const countAfterFirst = lockCallCount
      await req.session.lock()  // already owner → skips tryLock
      assert.strictEqual(lockCallCount, countAfterFirst, 'lock() should not re-acquire when already owner')
      assert.strictEqual(req.session.isLockOwner, true)
    })
  })

  // ─────────────────────────────────────────────
  describe('unlock() with store that has no unlock method', () => {
    it('returns without error when store has no unlock', async () => {
      const {mw} = createMiddleware()  // simple store has no lock/unlock
      const req = makeReq()
      await run(mw, req)

      // Should not throw even though store.unlock is undefined
      await assert.doesNotReject(() => req.session.unlock())
      assert.strictEqual(req.session.isLockOwner, false)
    })

    it('returns true when lock owner but store has no unlock method', async () => {
      const {mw} = createMiddleware()  // makeSimpleStore has no lock/unlock
      const req = makeReq()
      await run(mw, req)

      // tryLock skips store.lock when missing → #isLockOwner still becomes true
      await req.session.lock()
      assert.strictEqual(req.session.isLockOwner, true)
      const result = await req.session.unlock()
      assert.strictEqual(result, true)
      assert.strictEqual(req.session.isLockOwner, false)
    })
  })

  // ─────────────────────────────────────────────
  describe('save() on existing (non-new) session', () => {
    it('fetches from store when isNew is false', async () => {
      const store = makeSimpleStore()
      const {mw} = createMiddleware({store})

      // First request: create and save session
      const req1 = makeReq()
      const {res: res1} = await run(mw, req1)
      req1.session.data.x = 1
      await req1.session.save()

      // Second request: load existing session (isNew = false), modify and save
      const req2 = makeReq(getCookieValue(res1))
      await run(mw, req2)
      assert.strictEqual(req2.session.isNew, false)

      req2.session.data.x = 2
      await req2.session.save()

      const stored = await store.get(req2.session.id)
      assert.strictEqual(stored?.data?.x, 2)
    })

    it('falls back to createSessionRawData when store.get returns null for existing session', async () => {
      let getCallCount = 0
      const entries = {}
      const store = {
        get: async (id) => {
          getCallCount++;
          return entries[id] ?? null
        },
        set: async (id, data) => {
          entries[id] = data
        },
        delete: async (id) => {
          delete entries[id]
        },
      }
      const {mw} = createMiddleware({store})

      // Create and save session
      const req1 = makeReq()
      const {res: res1} = await run(mw, req1)
      req1.session.data.x = 1
      await req1.session.save()

      // Load existing session
      const req2 = makeReq(getCookieValue(res1))
      await run(mw, req2)
      assert.strictEqual(req2.session.isNew, false)

      // Delete session from store so get() returns null during save
      delete entries[req2.session.id]
      req2.session.data.x = 99
      await req2.session.save()  // isNew=false, store.get → null → createSessionRawData fallback

      const stored = await store.get(req2.session.id)
      assert.strictEqual(stored?.data?.x, 99)
    })
  })

  // ─────────────────────────────────────────────
  describe('debug option', () => {
    it('calls debug for save (non-merge store)', async () => {
      const messages = []
      const {mw, store} = createMiddleware({debug: (msg) => messages.push(msg)})

      const req = makeReq()
      await run(mw, req)
      req.session.data.x = 1
      await req.session.save()

      assert.ok(messages.some(m => m.includes('save')), 'debug should log save')
    })

    it('calls debug for save with merge store', async () => {
      const messages = []
      const store = createInMemoryStorage()
      const {mw} = createMiddleware({store, debug: (msg) => messages.push(msg)})

      const req = makeReq()
      await run(mw, req)
      req.session.data.x = 1
      await req.session.save()

      assert.ok(messages.some(m => m.includes('merge')), 'debug should log merge')
    })

    it('calls debug for destroy', async () => {
      const messages = []
      const {mw} = createMiddleware({debug: (msg) => messages.push(msg)})

      const req = makeReq()
      await run(mw, req)
      await req.session.destroy()

      assert.ok(messages.some(m => m.includes('destroy')), 'debug should log destroy')
    })

    it('calls debug for rotateId', async () => {
      const messages = []
      const {mw} = createMiddleware({debug: (msg) => messages.push(msg)})

      const req = makeReq()
      await run(mw, req)
      await req.session.rotateId()

      assert.ok(messages.some(m => m.includes('rotateId')), 'debug should log rotateId')
    })

    it('calls debug for save redirect path (after rotateId)', async () => {
      const messages = []
      const {mw} = createMiddleware({debug: (msg) => messages.push(msg)})

      const req = makeReq()
      await run(mw, req)
      req.session.data.x = 1
      await req.session.save()
      await req.session.rotateId()
      messages.length = 0  // clear previous messages
      await req.session.save()  // triggers redirect path

      assert.ok(messages.some(m => m.includes('redirect')), 'debug should log save redirect')
    })

    it('calls debug for save skip (no dirty paths)', async () => {
      const messages = []
      const {mw} = createMiddleware({debug: (msg) => messages.push(msg)})

      const req = makeReq()
      await run(mw, req)
      req.session.data.x = 1
      await req.session.save()  // saves and clears dirty
      messages.length = 0
      await req.session.save()  // nothing dirty → skip

      assert.ok(messages.some(m => m.includes('skip')), 'debug should log save skip')
    })
  })
})
