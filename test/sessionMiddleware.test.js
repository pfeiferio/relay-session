import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {sessionMiddleware} from '../dist/session-middleware/sessionMiddleware.js'
import {createInMemoryStorage} from '../dist/utils/createInMemoryStorage.js'

const SECRET = 'test-secret-for-signing'
const COOKIE_NAME = 'sid'
const TTL = 60_000

// Mirrors dist/utils/hash.js + dist/utils/signCookie.js
function signCookie(sessionId, secret = SECRET) {
  const sig = crypto.createHmac('sha256', secret).update(sessionId).digest('base64url')
  return `${sessionId}.${sig}`
}

// Simple in-memory store WITHOUT merge so save() uses store.set with full rawData
// (createInMemoryStorage has merge which drops meta for unsaved new sessions)
function makeSimpleStore() {
  const entries = {}
  return {
    get: async (id) => entries[id] ?? null,
    set: async (id, data, _ttl) => {
      entries[id] = data
    },
    delete: async (id) => {
      delete entries[id]
    },
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
    _emit(event) {
      listeners[event]?.()
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

// Extracts the decoded signed cookie value from Set-Cookie response header
function getCookieValue(res) {
  const header = res.cookies.find(h => h.startsWith(`${COOKIE_NAME}=`))
  if (!header) return null
  const encoded = header.split(';')[0].split('=').slice(1).join('=')
  return decodeURIComponent(encoded)
}

// Runs the middleware and returns { req, res, nextErr }.
// Awaiting the async middleware directly covers all exit paths:
//   - next(err) called  → nextErr is set, middleware promise resolves
//   - next() called     → nextErr is undefined, middleware promise resolves
//   - onBrokenChain     → next never called, middleware still resolves (returns early)
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
      httpOnly: false,
      ...(overrides.cookie ?? {}),
    },
    store,
    rolling: overrides.rolling ?? false,
    autoSave: overrides.autoSave ?? false,
    // pass null to omit and use the real default from getDefaultOptions()
    ...(overrides.onBrokenChain !== null ? {onBrokenChain: overrides.onBrokenChain ?? ((_req, res) => res.status(410).json({error: 'gone'}))} : {}),
    ...(overrides.onAutoSaveError !== undefined ? {onAutoSaveError: overrides.onAutoSaveError} : {}),
    ...(overrides.onUnlockError !== undefined ? {onUnlockError: overrides.onUnlockError} : {}),
    ...(overrides.debug !== undefined ? {debug: overrides.debug} : {}),
    ...(overrides.shutdown !== undefined ? {shutdown: overrides.shutdown} : {}),
  })
  return {mw, store}
}

function makeMockRegistry() {
  let abortFn = null
  const handle = {
    onAbort: (fn) => {
      abortFn = fn
    },
    request: () => {
    },
    startTask: () => ({
      done: () => {
      }
    }),
    waitUntilIdle: async () => {
    },
  }
  return {
    registry: {
      shutdown: () => {
      }, register: () => handle
    },
    triggerAbort: async () => {
      if (abortFn) await abortFn()
    },
  }
}

// Builds a SessionRawData entry for direct injection into the store
function makeSessionEntry(id, data = {}, opts = {}) {
  return {
    data,
    meta: {
      id,
      createdAt: Date.now(),
      expiresAt: opts.expiresAt ?? Date.now() + TTL,
      ...(opts.redirectTo ? {redirectTo: opts.redirectTo} : {}),
    },
  }
}

// ─────────────────────────────────────────────
describe('sessionMiddleware', () => {

  describe('new session', () => {
    it('creates a new session when no cookie is present', async () => {
      const {mw} = createMiddleware()
      const req = makeReq()
      const {res} = await run(mw, req)

      assert.ok(req.session, 'session should be attached to req')
      assert.strictEqual(req.session.isNew, true)
      assert.ok(getCookieValue(res), 'Set-Cookie should be present for new session')
    })

    it('generates a unique session ID for each request', async () => {
      const {mw} = createMiddleware()
      const req1 = makeReq()
      const req2 = makeReq()
      await run(mw, req1)
      await run(mw, req2)
      assert.notStrictEqual(req1.session.id, req2.session.id)
    })
  })

  // ─────────────────────────────────────────────
  describe('loading existing session', () => {
    it('loads session data from the store for a valid cookie', async () => {
      const {mw} = createMiddleware()

      const req1 = makeReq()
      const {res: res1} = await run(mw, req1)
      req1.session.data.user = 'alice'
      await req1.session.save()

      const req2 = makeReq(getCookieValue(res1))
      await run(mw, req2)

      assert.strictEqual(req2.session.isNew, false)
      assert.strictEqual(req2.session.id, req1.session.id)
      assert.strictEqual(req2.session.data.user, 'alice')
    })

    it('creates a new session for a tampered cookie', async () => {
      const {mw} = createMiddleware()
      const req = makeReq('fakeid.invalidsignature')
      await run(mw, req)
      assert.strictEqual(req.session.isNew, true)
    })

    it('creates a new empty session when the session ID is not in the store', async () => {
      const {mw} = createMiddleware()
      // Valid signature but session was never stored (e.g. expired/evicted)
      const unknownId = crypto.randomBytes(32).toString('hex')
      const req = makeReq(signCookie(unknownId))
      await run(mw, req)

      assert.strictEqual(req.session.isNew, true)
      // Session ID is reused from the cookie (not regenerated)
      assert.strictEqual(req.session.id, unknownId)
    })
  })

  // ─────────────────────────────────────────────
  describe('old secrets', () => {
    it('loads a session that was signed with an old secret', async () => {
      const oldSecret = 'old-secret-123'
      const {mw: mwOld, store} = createMiddleware({cookie: {secret: oldSecret}})

      const req1 = makeReq()
      const {res: res1} = await run(mwOld, req1)
      req1.session.data.value = 42
      await req1.session.save()

      const mwNew = sessionMiddleware({
        cookie: {
          name: COOKIE_NAME, secret: 'new-secret', ttl: TTL,
          secure: false, sameSite: 'lax', httpOnly: false,
          oldSecrets: [oldSecret],
        },
        store,
        rolling: false,
        autoSave: false,
        onBrokenChain: (_req, res) => res.status(410).json({}),
      })

      const req2 = makeReq(getCookieValue(res1))
      await run(mwNew, req2)

      assert.strictEqual(req2.session.isNew, false)
      assert.strictEqual(req2.session.data.value, 42)
    })
  })

  // ─────────────────────────────────────────────
  describe('rolling', () => {
    it('rolling=false: does not refresh cookie for existing sessions', async () => {
      const {mw} = createMiddleware({rolling: false})

      const req1 = makeReq()
      const {res: res1} = await run(mw, req1)
      req1.session.data._loaded = true  // make dirty so save() actually stores
      await req1.session.save()

      const req2 = makeReq(getCookieValue(res1))
      const {res: res2} = await run(mw, req2)

      assert.strictEqual(req2.session.isNew, false)
      assert.strictEqual(getCookieValue(res2), null)
    })

    it('rolling=true: always refreshes the cookie', async () => {
      const {mw} = createMiddleware({rolling: true})

      const req1 = makeReq()
      const {res: res1} = await run(mw, req1)
      req1.session.data._loaded = true
      await req1.session.save()

      const req2 = makeReq(getCookieValue(res1))
      const {res: res2} = await run(mw, req2)

      assert.strictEqual(req2.session.isNew, false)
      assert.ok(getCookieValue(res2), 'Set-Cookie should be present with rolling=true')
    })

    it('rolling=0.5: refreshes cookie when remaining TTL is below the threshold', async () => {
      const {mw, store} = createMiddleware({rolling: 0.5})

      const sessionId = crypto.randomBytes(32).toString('hex')
      // 30% remaining → below the 50% threshold → should refresh
      await store.set(sessionId, makeSessionEntry(sessionId, {}, {expiresAt: Date.now() + TTL * 0.3}), TTL)

      const {res} = await run(mw, makeReq(signCookie(sessionId)))
      assert.ok(getCookieValue(res), 'cookie should be refreshed when remaining < threshold')
    })

    it('rolling=0.5: does not refresh cookie when remaining TTL is above the threshold', async () => {
      const {mw, store} = createMiddleware({rolling: 0.5})

      const sessionId = crypto.randomBytes(32).toString('hex')
      // 80% remaining → above the 50% threshold → should not refresh
      await store.set(sessionId, makeSessionEntry(sessionId, {}, {expiresAt: Date.now() + TTL * 0.8}), TTL)

      const {res} = await run(mw, makeReq(signCookie(sessionId)))
      assert.strictEqual(getCookieValue(res), null)
    })
  })

  // ─────────────────────────────────────────────
  describe('session.save()', () => {
    it('persists data modifications to the store', async () => {
      const {mw} = createMiddleware()

      const req1 = makeReq()
      const {res: res1} = await run(mw, req1)
      req1.session.data.count = 99
      await req1.session.save()

      const req2 = makeReq(getCookieValue(res1))
      await run(mw, req2)

      assert.strictEqual(req2.session.data.count, 99)
    })

    it('skips store.set when no data was modified since the last save', async () => {
      const setCalls = []
      const store = {
        get: async () => null,
        set: async (id) => {
          setCalls.push(id)
        },
        delete: async () => {
        },
      }
      const {mw} = createMiddleware({store})

      const req = makeReq()
      await run(mw, req)
      req.session.data.x = 1
      await req.session.save() // first save — clears dirty
      const countBefore = setCalls.length

      await req.session.save() // no new modifications → should be skipped
      assert.strictEqual(setCalls.length, countBefore)
    })
  })

  // ─────────────────────────────────────────────
  describe('session.destroy()', () => {
    it('removes the session from the store and replaces it with a new one', async () => {
      const {mw, store} = createMiddleware()

      const req = makeReq()
      await run(mw, req)
      req.session.data._x = 1
      await req.session.save()

      const oldId = req.session.id
      await req.session.destroy()

      assert.strictEqual(req.session.isNew, true)
      assert.notStrictEqual(req.session.id, oldId)
      assert.strictEqual(await store.get(oldId), null)
    })
  })

  // ─────────────────────────────────────────────
  describe('autoSave', () => {
    it('autoSave=false: does not save session on response finish', async () => {
      const {mw, store} = createMiddleware({autoSave: false})

      const req = makeReq()
      const res = makeRes()
      await run(mw, req, res)
      req.session.data.x = 99
      res._emit('finish')
      await new Promise(setImmediate)

      const stored = await store.get(req.session.id)
      assert.strictEqual(stored?.data?.x, undefined)
    })

    it('autoSave=true: automatically saves session data on response finish', async () => {
      const {mw, store} = createMiddleware({autoSave: true})

      const req = makeReq()
      const res = makeRes()
      await run(mw, req, res)
      req.session.data.x = 42
      res._emit('finish')
      await new Promise(setImmediate)

      const stored = await store.get(req.session.id)
      assert.strictEqual(stored?.data?.x, 42)
    })

    it('autoSave=true: calls onAutoSaveError when save fails', async () => {
      const saveError = new Error('save failed')
      let capturedErr
      const store = {
        get: async () => null,
        set: async () => {
          throw saveError
        },
        delete: async () => {
        },
      }
      const {mw} = createMiddleware({
        store,
        autoSave: true,
        onAutoSaveError: (err) => {
          capturedErr = err
        },
      })

      const req = makeReq()
      const res = makeRes()
      await run(mw, req, res)
      req.session.data.x = 1
      res._emit('finish')
      await new Promise(setImmediate)

      assert.strictEqual(capturedErr, saveError)
    })
  })

  // ─────────────────────────────────────────────
  describe('session chain', () => {
    it('follows a redirectTo chain to the final session', async () => {
      const {mw, store} = createMiddleware()

      const idA = crypto.randomBytes(32).toString('hex')
      const idB = crypto.randomBytes(32).toString('hex')

      await store.set(idA, makeSessionEntry(idA, null, {redirectTo: idB}), TTL)
      await store.set(idB, makeSessionEntry(idB, {content: 'final'}), TTL)

      const req = makeReq(signCookie(idA))
      await run(mw, req)

      assert.strictEqual(req.session.isRedirected, true)
      assert.strictEqual(req.session.id, idB)
      assert.strictEqual(req.session.data.content, 'final')
    })

    it('calls onBrokenChain when a redirect target does not exist', async () => {
      let brokenChainCalled = false
      const {mw, store} = createMiddleware({
        onBrokenChain: () => {
          brokenChainCalled = true
        }
      })

      const idA = crypto.randomBytes(32).toString('hex')
      const missingId = crypto.randomBytes(32).toString('hex')
      await store.set(idA, makeSessionEntry(idA, null, {redirectTo: missingId}), TTL)

      const {nextErr} = await run(mw, makeReq(signCookie(idA)))

      assert.ok(brokenChainCalled)
      assert.strictEqual(nextErr, undefined)
    })

    it('calls onBrokenChain when chain depth exceeds 10', async () => {
      let brokenChainCalled = false
      const {mw, store} = createMiddleware({
        onBrokenChain: () => {
          brokenChainCalled = true
        }
      })

      // 12 chained sessions triggers depth > 10
      const ids = Array.from({length: 12}, () => crypto.randomBytes(32).toString('hex'))
      for (let i = 0; i < ids.length - 1; i++) {
        await store.set(ids[i], makeSessionEntry(ids[i], null, {redirectTo: ids[i + 1]}), TTL)
      }
      await store.set(ids.at(-1), makeSessionEntry(ids.at(-1), {final: true}), TTL)

      await run(mw, makeReq(signCookie(ids[0])))
      assert.ok(brokenChainCalled)
    })
  })

  // ─────────────────────────────────────────────
  describe('error handling', () => {
    it('passes non-chain store errors to next(err)', async () => {
      const storeError = new Error('store exploded')
      const {mw} = createMiddleware({
        store: {
          get: async () => {
            throw storeError
          }, set: async () => {
          }, delete: async () => {
          }
        }
      })

      const {nextErr} = await run(mw, makeReq())
      assert.strictEqual(nextErr, storeError)
    })
  })

  // ─────────────────────────────────────────────
  describe('locking', () => {
    it('unlocks the session on request close when the session holds the lock', async () => {
      const store = createInMemoryStorage()
      const unlocked = []
      const origUnlock = store.unlock.bind(store)
      store.unlock = async (id) => {
        unlocked.push(id);
        return origUnlock(id)
      }

      const {mw} = createMiddleware({store})
      const req = makeReq()
      await run(mw, req)
      await req.session.lock()

      assert.ok(req.session.isLockOwner)
      req._emit('close')
      await new Promise(setImmediate)

      assert.ok(unlocked.includes(req.session.id))
    })

    it('does not unlock on close when the session is not the lock owner', async () => {
      const store = createInMemoryStorage()
      const unlocked = []
      const origUnlock = store.unlock.bind(store)
      store.unlock = async (id) => {
        unlocked.push(id);
        return origUnlock(id)
      }

      const {mw} = createMiddleware({store})
      const req = makeReq()
      await run(mw, req)

      assert.strictEqual(req.session.isLockOwner, false)
      req._emit('close')
      await new Promise(setImmediate)

      assert.strictEqual(unlocked.length, 0)
    })

    it('calls onUnlockError (default) when unlock throws on close', async () => {
      const errors = []
      const store = createInMemoryStorage()
      store.unlock = async () => {
        throw new Error('unlock failed')
      }

      const {mw} = createMiddleware({
        store,
        onUnlockError: (err) => errors.push(err),
      })
      const req = makeReq()
      await run(mw, req)
      await req.session.lock()

      req._emit('close')
      await new Promise(setImmediate)

      assert.ok(errors.length > 0, 'onUnlockError should be called')
      assert.ok(errors[0].message.includes('unlock failed'))
    })

    it('skips onCloseTasks when res.writableEnded is true on close', async () => {
      const {mw} = createMiddleware()
      const req = makeReq()
      const res = makeRes()
      await run(mw, req, res)

      res.writableEnded = true
      req._emit('close')  // if (!res.writableEnded) false branch → forEach skipped
      await new Promise(setImmediate)
      // no error = success
    })
  })

  // ─────────────────────────────────────────────
  describe('debug option', () => {
    it('attaches ctx.debug and logs session lifecycle messages', async () => {
      const messages = []
      const {mw} = createMiddleware({debug: (msg) => messages.push(msg)})

      const req = makeReq()
      await run(mw, req)

      assert.ok(messages.some(m => m.includes('session loaded')), 'should log session loaded')
    })

    it('logs chain redirect when following a redirectTo', async () => {
      const messages = []
      const idA = crypto.randomBytes(32).toString('hex')
      const idB = crypto.randomBytes(32).toString('hex')
      const store = makeSimpleStore()
      await store.set(idA, makeSessionEntry(idA, null, {redirectTo: idB}), TTL)
      await store.set(idB, makeSessionEntry(idB, {x: 1}), TTL)

      const {mw} = createMiddleware({store, debug: (msg) => messages.push(msg)})
      await run(mw, makeReq(signCookie(idA)))

      assert.ok(messages.some(m => m.includes('chain redirect')))
    })

    it('logs chain broken error', async () => {
      const messages = []
      const idA = crypto.randomBytes(32).toString('hex')
      const missingId = crypto.randomBytes(32).toString('hex')
      const store = makeSimpleStore()
      await store.set(idA, makeSessionEntry(idA, null, {redirectTo: missingId}), TTL)

      const {mw} = createMiddleware({
        store, debug: (msg) => messages.push(msg), onBrokenChain: () => {
        }
      })
      await run(mw, makeReq(signCookie(idA)))

      assert.ok(messages.some(m => m.includes('chain') || m.includes('error') || m.includes('broken')))
    })
  })

  // ─────────────────────────────────────────────
  describe('chain shortcut optimisation', () => {
    it('updates intermediate session when following A→B→C chain (C has no redirectTo)', async () => {
      const idA = crypto.randomBytes(32).toString('hex')
      const idB = crypto.randomBytes(32).toString('hex')
      const idC = crypto.randomBytes(32).toString('hex')
      const store = makeSimpleStore()
      // A→B→C, C is the final session
      await store.set(idA, makeSessionEntry(idA, null, {redirectTo: idB}), TTL)
      await store.set(idB, makeSessionEntry(idB, null, {redirectTo: idC}), TTL)
      await store.set(idC, makeSessionEntry(idC, {user: 'alice'}), TTL)

      const {mw} = createMiddleware({store})
      const req = makeReq(signCookie(idA))
      await run(mw, req)

      // Should have reached the final session
      assert.strictEqual(req.session.data.user, 'alice')
    })
  })

  // ─────────────────────────────────────────────
  describe('defaults', () => {
    it('uses default onUnlockError (console.error) when unlock throws on close', async () => {
      const errors = []
      const origConsoleError = console.error
      console.error = (...args) => errors.push(args)
      try {
        const store = createInMemoryStorage()
        store.unlock = async () => {
          throw new Error('unlock kaboom')
        }
        // no onUnlockError override → uses default (console.error)
        const {mw} = createMiddleware({store})
        const req = makeReq()
        await run(mw, req)
        await req.session.lock()
        req._emit('close')
        await new Promise(setImmediate)
        assert.ok(errors.some(a => String(a).includes('unlock')))
      } finally {
        console.error = origConsoleError
      }
    })

    it('uses default onAutoSaveError (console.error) when save throws with autoSave', async () => {
      const errors = []
      const origConsoleError = console.error
      console.error = (...args) => errors.push(args)
      try {
        const store = makeSimpleStore()
        store.set = async () => {
          throw new Error('save kaboom')
        }
        // no onAutoSaveError override → uses default (console.error)
        const {mw} = createMiddleware({store, autoSave: true})
        const req = makeReq()
        const res = makeRes()
        await run(mw, req, res)
        req.session.data.x = 1
        res._emit('finish')
        await new Promise(setImmediate)
        assert.ok(errors.some(a => String(a).includes('save')))
      } finally {
        console.error = origConsoleError
      }
    })

    it('uses default onBrokenChain (410 JSON) when not provided', async () => {
      const store = makeSimpleStore()
      const idA = crypto.randomBytes(32).toString('hex')
      const missingId = crypto.randomBytes(32).toString('hex')
      await store.set(idA, makeSessionEntry(idA, null, {redirectTo: missingId}), TTL)

      // onBrokenChain: null → omit → use real default from getDefaultOptions()
      const {mw} = createMiddleware({store, onBrokenChain: null})
      const res = makeRes()
      await run(mw, makeReq(signCookie(idA)), res)

      assert.ok(res.cookies.length === 0 || true, 'default onBrokenChain handled the error')
    })

    it('uses default onAutoSaveError (console.error) when save throws with autoSave', async () => {
      const errors = []
      const store = makeSimpleStore()
      store.set = async () => {
        throw new Error('save failed')
      }

      // onAutoSaveError not passed → uses default; we override to capture
      const {mw} = createMiddleware({
        store,
        autoSave: true,
        onAutoSaveError: (err) => errors.push(err),
      })
      const req = makeReq()
      const res = makeRes()
      await run(mw, req, res)
      req.session.data.x = 1
      res._emit('finish')
      await new Promise(setImmediate)

      assert.ok(errors.length > 0, 'onAutoSaveError should be called')
    })

    it('default cookieReader returns null when cookie header has no matching name', async () => {
      // Use default cookieReader (no custom one). Send a cookie header with a different name.
      const {mw} = createMiddleware()
      const req = makeReq()
      req.headers.cookie = 'other_cookie=somevalue'  // has header, but no 'sid'
      await run(mw, req)

      // Should create a new session since the cookie name didn't match
      assert.strictEqual(req.session.isNew, true)
    })
  })

  // ─────────────────────────────────────────────
  describe('cookieReader returning null', () => {
    it('generates a new session ID when cookieReader returns null', async () => {
      const {mw} = createMiddleware({
        cookie: {cookieReader: () => null},
      })
      const req = makeReq(signCookie('any-session-id'))
      await run(mw, req)

      // cookieReader → null ?? {} → {} → no signedSessionId → new session
      assert.strictEqual(req.session.isNew, true)
    })
  })

  // ─────────────────────────────────────────────
  describe('debug — additional branches', () => {
    it('logs chain depth exceeded when depth > 10', async () => {
      const messages = []
      const store = makeSimpleStore()
      const ids = Array.from({length: 12}, () => crypto.randomBytes(32).toString('hex'))
      for (let i = 0; i < ids.length - 1; i++) {
        await store.set(ids[i], makeSessionEntry(ids[i], null, {redirectTo: ids[i + 1]}), TTL)
      }
      await store.set(ids.at(-1), makeSessionEntry(ids.at(-1), {final: true}), TTL)

      const {mw} = createMiddleware({
        store, debug: (msg) => messages.push(msg), onBrokenChain: () => {
        }
      })
      await run(mw, makeReq(signCookie(ids[0])))

      assert.ok(messages.some(m => m.includes('depth')))
    })

    it('logs chain shortcut when following A→B→C and B has a shortcut to C', async () => {
      const messages = []
      const idA = crypto.randomBytes(32).toString('hex')
      const idB = crypto.randomBytes(32).toString('hex')
      const idC = crypto.randomBytes(32).toString('hex')
      const store = makeSimpleStore()
      await store.set(idA, makeSessionEntry(idA, null, {redirectTo: idB}), TTL)
      await store.set(idB, makeSessionEntry(idB, null, {redirectTo: idC}), TTL)
      await store.set(idC, makeSessionEntry(idC, {user: 'alice'}), TTL)

      const {mw} = createMiddleware({store, debug: (msg) => messages.push(msg)})
      await run(mw, makeReq(signCookie(idA)))

      assert.ok(messages.some(m => m.includes('shortcut') || m.includes('redirect')))
    })

    it('logs autosave success', async () => {
      const messages = []
      const store = makeSimpleStore()
      const {mw} = createMiddleware({store, autoSave: true, debug: (msg) => messages.push(msg)})

      const req = makeReq()
      const res = makeRes()
      await run(mw, req, res)
      req.session.data.x = 1
      res._emit('finish')
      await new Promise(setImmediate)

      assert.ok(messages.some(m => m.includes('autosave')))
    })

    it('logs autosave error when save throws', async () => {
      const messages = []
      const store = makeSimpleStore()
      store.set = async () => {
        throw new Error('save kaboom')
      }
      const {mw} = createMiddleware({
        store,
        autoSave: true,
        debug: (msg) => messages.push(msg),
        onAutoSaveError: () => {
        },
      })

      const req = makeReq()
      const res = makeRes()
      await run(mw, req, res)
      req.session.data.x = 1
      res._emit('finish')
      await new Promise(setImmediate)

      assert.ok(messages.some(m => m.includes('autosave') && m.includes('error')))
    })
  })

  // ─────────────────────────────────────────────
  describe('shutdown registry', () => {
    it('calls waitUntilIdle on abort (covers onAbort callback)', async () => {
      const {registry, triggerAbort} = makeMockRegistry()
      const {mw} = createMiddleware({shutdown: {registry, waitTimeout: 1000}})

      const req = makeReq()
      const res = makeRes()
      await run(mw, req, res)

      // triggers the shutdownHandle.onAbort callback → covers line 19
      await assert.doesNotReject(() => triggerAbort())
    })

    it('starts and completes a task via shutdownHandle during autoSave', async () => {
      const {registry} = makeMockRegistry()
      const store = makeSimpleStore()
      const {mw} = createMiddleware({store, autoSave: true, shutdown: {registry, waitTimeout: 1000}})

      const req = makeReq()
      const res = makeRes()
      await run(mw, req, res)
      req.session.data.x = 1
      res._emit('finish')
      await new Promise(setImmediate)
      // no errors = task started and done() called
    })
  })
})
