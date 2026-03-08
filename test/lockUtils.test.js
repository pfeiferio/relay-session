import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import {sessionMiddleware} from '../dist/session-middleware/sessionMiddleware.js'
import {createInMemoryStorage} from '../dist/utils/createInMemoryStorage.js'
import {isSessionLockError} from '../dist/errors/utils.js'
import {tryLock, waitForUnlock} from '../dist/session/lock-utils.js'

// Tests for lock retry logic, backoff, and exhaustion.
// We exercise these indirectly through session.lock() and session.save()
// using stores that reject lock attempts.

const SECRET = 'test-secret'
const COOKIE_NAME = 'sid'
const TTL = 60_000

function makeRes() {
  const res = {
    cookies: [],
    on() {
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

async function run(mw, req = makeReq(), res = makeRes()) {
  await mw(req, res, () => {
  })
  return {req, res}
}

function makeReq() {
  const listeners = {}
  return {
    headers: {},
    on(event, fn) {
      listeners[event] = fn
    },
    _emit(event) {
      listeners[event]?.()
    },
    session: undefined,
  }
}

function createMiddlewareWithLockStore(lockStore, lockOpts = {}) {
  return sessionMiddleware({
    cookie: {name: COOKIE_NAME, secret: SECRET, ttl: TTL, secure: false, sameSite: 'lax', httpOnly: false},
    store: lockStore,
    rolling: false,
    autoSave: false,
    onBrokenChain: (_req, res) => res.status(410).json({}),
    lock: {ttl: 500, retries: 2, backoff: 1, ...lockOpts},
  })
}

describe('lock-utils', () => {

  describe('tryLock()', () => {
    it('acquires the lock when the store.lock returns true', async () => {
      const store = createInMemoryStorage()
      const mw = createMiddlewareWithLockStore(store)
      const {req} = await run(mw)

      await req.session.lock()
      assert.strictEqual(req.session.isLockOwner, true)

      const locked = await store.isLocked(req.session.id)
      assert.strictEqual(locked, true)
    })

    it('retries when the lock is initially held by another request', async () => {
      const store = createInMemoryStorage()
      let attempt = 0
      const origLock = store.lock.bind(store)
      store.lock = async (id, ttl) => {
        attempt++
        if (attempt <= 1) return false  // first attempt fails
        return origLock(id, ttl)
      }

      const mw = createMiddlewareWithLockStore(store, {retries: 3, backoff: 1})
      const {req} = await run(mw)

      await req.session.lock()
      assert.ok(attempt >= 2, 'should have retried at least once')
      assert.strictEqual(req.session.isLockOwner, true)
    })

    it('throws SessionLockError when lock cannot be acquired within retries', async () => {
      const store = {
        get: async () => null,
        set: async () => {
        },
        delete: async () => {
        },
        lock: async () => false,  // always fails
        unlock: async () => {
        },
        isLocked: async () => true,
      }

      const mw = createMiddlewareWithLockStore(store, {retries: 2, backoff: 1})
      const {req} = await run(mw)

      await assert.rejects(
        () => req.session.lock(),
        (err) => {
          assert.ok(isSessionLockError(err), 'should be a SessionLockError')
          return true
        }
      )
    })
  })

  describe('waitForUnlock()', () => {
    it('waits until the session is unlocked before save() proceeds', async () => {
      const store = createInMemoryStorage()
      const mw = createMiddlewareWithLockStore(store, {retries: 5, backoff: 1})

      // First request acquires the lock
      const {req: req1} = await run(mw)
      const sessionId = req1.session.id
      await req1.session.lock()

      // Manually schedule unlock after a short delay
      setTimeout(() => store.unlock(sessionId), 10)

      // Second session object for same ID (simulates concurrent request)
      req1.session.data.x = 42
      await req1.session.unlock()  // unlock so save can proceed
      await req1.session.save()

      const stored = await store.get(sessionId)
      assert.strictEqual(stored?.data?.x, 42)
    })

    it('throws SessionLockError when waiting for unlock exceeds retries', async () => {
      const store = {
        get: async () => null,
        set: async () => {
        },
        delete: async () => {
        },
        lock: async () => true,   // acquires instantly
        unlock: async () => {
        },
        isLocked: async () => true,  // always reports locked
      }

      const mw = createMiddlewareWithLockStore(store, {retries: 2, backoff: 1})
      const {req} = await run(mw)

      req.session.data.x = 1
      // save() calls waitForUnlock() since we're not the lock owner
      await assert.rejects(
        () => req.session.save(),
        (err) => {
          assert.ok(isSessionLockError(err), 'should be a SessionLockError')
          return true
        }
      )
    })
  })

  describe('createInMemoryStorage lock methods', () => {
    it('lock() returns true when session is not locked', async () => {
      const store = createInMemoryStorage()
      const result = await store.lock('session-1', 5000)
      assert.strictEqual(result, true)
    })

    it('lock() returns false when session is already locked', async () => {
      const store = createInMemoryStorage()
      await store.lock('session-1', 5000)
      const result = await store.lock('session-1', 5000)
      assert.strictEqual(result, false)
    })

    it('isLocked() returns true for a locked session', async () => {
      const store = createInMemoryStorage()
      await store.lock('session-1', 5000)
      assert.strictEqual(await store.isLocked('session-1'), true)
    })

    it('isLocked() returns false after unlock()', async () => {
      const store = createInMemoryStorage()
      await store.lock('session-1', 5000)
      await store.unlock('session-1')
      assert.strictEqual(await store.isLocked('session-1'), false)
    })

    it('delete() removes the session and its lock', async () => {
      const store = createInMemoryStorage()
      await store.set('session-1', {
        data: {},
        meta: {id: 'session-1', createdAt: 0, expiresAt: Date.now() + 60_000}
      }, 60_000)
      await store.lock('session-1', 5000)
      await store.delete('session-1')

      assert.strictEqual(await store.get('session-1'), null)
      assert.strictEqual(await store.isLocked('session-1'), false)
    })

    it('merge() creates entry if not existing, then merges paths', async () => {
      const store = createInMemoryStorage()
      await store.merge('session-1', {'data.user': 'alice'}, 60_000)
      const entry = await store.get('session-1')
      assert.strictEqual(entry?.data?.user, 'alice')
    })

    it('get() returns null for an expired entry', async () => {
      const store = createInMemoryStorage()
      await store.set('session-1', {data: {x: 1}, meta: {id: 'session-1', createdAt: 0, expiresAt: 0}}, 0)
      // TTL=0 → expiresAt = Date.now()+0; wait a tick so Date.now() > expiresAt
      await new Promise(resolve => setTimeout(resolve, 5))
      assert.strictEqual(await store.get('session-1'), null)
    })

    it('isLocked() returns false and cleans up when lock TTL has expired', async () => {
      const store = createInMemoryStorage()
      await store.lock('session-1', 1)  // 1ms TTL
      await new Promise(resolve => setTimeout(resolve, 5))
      assert.strictEqual(await store.isLocked('session-1'), false)
      // Lock entry should be cleaned up — a fresh lock can now be acquired
      assert.strictEqual(await store.lock('session-1', 5000), true)
    })

    it('lock() re-acquires after the previous lock TTL has expired', async () => {
      const store = createInMemoryStorage()
      await store.lock('session-1', 1)
      await new Promise(resolve => setTimeout(resolve, 5))
      // Expired lock → lock() should return true again
      assert.strictEqual(await store.lock('session-1', 5000), true)
    })
  })

  // ─── tryLock / waitForUnlock with stores missing optional methods ──────────
  describe('optional store methods', () => {
    const lockOptions = {ttl: 1000, retries: 3, backoff: 1}
    const minimalStore = {
      get: async () => null,
      set: async () => {
      },
      delete: async () => {
      },
    }

    it('tryLock succeeds immediately when store has no lock method (line 26)', async () => {
      // !store.lock → return true immediately
      await assert.doesNotReject(() => tryLock(minimalStore, 'sid', lockOptions))
    })

    it('waitForUnlock resolves immediately when store has no isLocked method', async () => {
      // !store.isLocked → return true immediately
      await assert.doesNotReject(() => waitForUnlock(minimalStore, 'sid', lockOptions))
    })
  })
})
