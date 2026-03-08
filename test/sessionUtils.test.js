import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {sessionMiddleware} from '../dist/session-middleware/sessionMiddleware.js'
import {createInMemoryStorage} from '../dist/utils/createInMemoryStorage.js'
import {isSessionRedirectData, updatePreviousSession} from '../dist/session/utils.js'

const SECRET = 'test-secret'
const COOKIE_NAME = 'sid'
const TTL = 60_000

function signCookie(sessionId) {
  const sig = crypto.createHmac('sha256', SECRET).update(sessionId).digest('base64url')
  return `${sessionId}.${sig}`
}

function makeReq(signedCookieValue = null) {
  const listeners = {}
  return {
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
}

function makeRes() {
  return {
    cookies: [],
    on() {
    },
    appendHeader(name, value) {
      if (name === 'Set-Cookie') this.cookies.push(value)
    },
    writableEnded: false,
    status() {
      return this
    },
    json() {
      return this
    },
  }
}

async function run(mw, req, res = makeRes()) {
  await mw(req, res, () => {
  })
  return {req, res}
}

function createMw(store) {
  return sessionMiddleware({
    cookie: {name: COOKIE_NAME, secret: SECRET, ttl: TTL, secure: false, sameSite: 'lax', httpOnly: false},
    store,
    rolling: false,
    autoSave: false,
    onBrokenChain: (_req, res) => res.status(410).json({}),
  })
}

describe('session/utils', () => {

  // ─── isSessionRedirectData ────────────────────────────────────────────────
  describe('isSessionRedirectData()', () => {
    it('returns true when data is null and meta has redirectTo', () => {
      const entry = {data: null, meta: {id: 'x', redirectTo: 'y', createdAt: 0, expiresAt: 0}}
      assert.strictEqual(isSessionRedirectData(entry), true)
    })

    it('returns false when data is not null', () => {
      const entry = {data: {user: 'alice'}, meta: {id: 'x', redirectTo: 'y', createdAt: 0, expiresAt: 0}}
      assert.strictEqual(isSessionRedirectData(entry), false)
    })

    it('returns false when meta has no redirectTo', () => {
      const entry = {data: null, meta: {id: 'x', createdAt: 0, expiresAt: 0}}
      assert.strictEqual(isSessionRedirectData(entry), false)
    })
  })

  // ─── updatePreviousSession — merge branch ─────────────────────────────────
  describe('updatePreviousSession() with merge store', () => {
    it('stores redirectTo via merge when store has merge method', async () => {
      const store = createInMemoryStorage()
      const oldId = 'old-session'
      await store.set(oldId, {data: {x: 1}, meta: {id: oldId, createdAt: Date.now(), expiresAt: Date.now() + TTL}}, TTL)

      const fakeOptions = {
        store,
        rotation: {gracePeriod: TTL},
      }
      await updatePreviousSession(fakeOptions, {id: oldId, redirectTo: 'new-session'})

      const stored = await store.get(oldId)
      assert.strictEqual(stored?.meta?.redirectTo, 'new-session')
    })

    it('sets redirectTo via middleware rotateId with merge store', async () => {
      const store = createInMemoryStorage()
      const mw = createMw(store)

      const {req} = await run(mw, makeReq())
      req.session.data.x = 1
      await req.session.save()

      const oldId = req.session.id
      await req.session.rotateId()
      const newId = req.session.raw.meta.redirectTo

      await req.session.save()  // triggers updatePreviousSession via merge

      const oldEntry = await store.get(oldId)
      assert.strictEqual(oldEntry?.meta?.redirectTo, newId)
    })
  })

  // ─── updatePreviousSession — set branch (already covered, verify here too) ─
  describe('updatePreviousSession() with set-only store', () => {
    it('stores redirectTo via set when store has no merge method', async () => {
      const entries = {}
      const store = {
        get: async (id) => entries[id] ?? null,
        set: async (id, data) => {
          entries[id] = data
        },
        delete: async (id) => {
          delete entries[id]
        },
      }

      const fakeOptions = {
        store,
        rotation: {gracePeriod: TTL},
      }
      await updatePreviousSession(fakeOptions, {id: 'old', redirectTo: 'new'})

      assert.strictEqual(entries['old']?.meta?.redirectTo, 'new')
    })
  })
})
