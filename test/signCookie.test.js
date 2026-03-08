import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import {sessionMiddleware} from '../dist/session-middleware/sessionMiddleware.js'
import {createSignature, verifySessionId} from '../dist/utils/signCookie.js'

const SECRET = 'test-secret'
const COOKIE_NAME = 'sid'
const TTL = 60_000

function makeSimpleStore() {
  const entries = {}
  return {
    get: async (id) => entries[id] ?? null,
    set: async (id, data) => {
      entries[id] = data
    },
    delete: async (id) => {
      delete entries[id]
    },
  }
}

function makeReq(cookieValue = null) {
  const listeners = {}
  const req = {
    headers: cookieValue
      ? {cookie: `${COOKIE_NAME}=${encodeURIComponent(cookieValue)}`}
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

function createMw(overrides = {}) {
  const store = overrides.store ?? makeSimpleStore()
  return sessionMiddleware({
    cookie: {
      name: COOKIE_NAME,
      secret: SECRET,
      ttl: TTL,
      secure: false,
      sameSite: 'lax',
      httpOnly: false, ...(overrides.cookie ?? {})
    },
    store,
    rolling: false,
    autoSave: false,
    onBrokenChain: (_req, res) => res.status(410).json({}),
    ...(overrides.signWith ? {signWith: overrides.signWith} : {}),
  })
}

// Minimal ctx factory for direct function tests
function makeCtx(overrides = {}) {
  return {
    options: {
      cookie: {secret: SECRET, oldSecrets: []},
      signWith: undefined,
      ...overrides.options,
    },
    req: {},
    debug: overrides.debug,
  }
}

describe('signCookie', () => {

  // ─── lines 19-20: signWith returning an array ────────────────────────────
  describe('signWith returning an array', () => {
    it('joins array elements with | and binds cookie to that combined context', async () => {
      const store = makeSimpleStore()
      const mw = createMw({
        store,
        signWith: (req) => [req.headers['x-role'] ?? '', req.headers['x-user'] ?? ''],
      })

      // Create and save session
      const req1 = makeReq()
      req1.headers['x-role'] = 'admin'
      req1.headers['x-user'] = 'alice'
      const {res: res1} = await run(mw, req1)
      req1.session.data.val = 'secret'
      await req1.session.save()

      // Same context → should load the session
      const req2 = makeReq(getCookieValue(res1))
      req2.headers['x-role'] = 'admin'
      req2.headers['x-user'] = 'alice'
      await run(mw, req2)
      assert.strictEqual(req2.session.isNew, false)
      assert.strictEqual(req2.session.data.val, 'secret')

      // Different context → cookie verification fails → new session
      const req3 = makeReq(getCookieValue(res1))
      req3.headers['x-role'] = 'guest'
      req3.headers['x-user'] = 'alice'
      await run(mw, req3)
      assert.strictEqual(req3.session.isNew, true)
    })
  })

  // ─── lines 33, 39-41: malformed cookie paths ─────────────────────────────
  describe('malformed cookie', () => {
    it('creates a new session when cookie has empty sessionId (starts with .)', async () => {
      const mw = createMw()
      // ".signature" → lastDot at 0 → sessionId = '' → !sessionId → return null
      const req = makeReq('.invalidsignature')
      await run(mw, req)
      assert.strictEqual(req.session.isNew, true)
    })

    it('creates a new session when cookie has empty signature (ends with .)', async () => {
      const mw = createMw()
      // "sessionid." → lastDot at last pos → signature = '' → !signature → return null
      const req = makeReq('somesessionid.')
      await run(mw, req)
      assert.strictEqual(req.session.isNew, true)
    })

    it('returns null for cookie with no dot (lastDot === -1)', () => {
      const ctx = makeCtx()
      // line 33: if (lastDot === -1) return null
      const result = verifySessionId(ctx, 'nodotcookievalue')
      assert.strictEqual(result, null)
    })

    it('calls ctx.debug when cookie is malformed and debug is set', () => {
      const debugMessages = []
      const ctx = makeCtx({debug: (msg) => debugMessages.push(msg)})
      // line 39: ctx.debug?.() with truthy debug fn
      verifySessionId(ctx, '.invalidsignature')
      assert.ok(debugMessages.some(m => m.includes('malformed cookie')))
    })
  })

  // ─── line 49: ctx.debug on valid/invalid verify ───────────────────────────
  describe('debug on verify result', () => {
    it('calls ctx.debug with verify result when debug is set', () => {
      const debugMessages = []
      const ctx = makeCtx({debug: (msg) => debugMessages.push(msg)})
      const sessionId = 'my-session'
      const sig = createSignature(ctx, sessionId, SECRET)
      // line 49: ctx.debug?.() with truthy debug fn on both valid and invalid result
      verifySessionId(ctx, `${sessionId}.${sig}`)
      verifySessionId(ctx, `${sessionId}.wrongsig`)
      assert.ok(debugMessages.some(m => m.includes('verify session')))
    })
  })

  // ─── lines 66-67: falsy entry in oldSecrets → continue ──────────────────
  // validateOptions rejects empty strings in oldSecrets, so we test verifySessionId
  // directly with a crafted ctx. The main secret must NOT match first so the loop
  // reaches the falsy entry (triggering continue) before finding the valid old secret.
  describe('falsy oldSecrets entry', () => {
    it('skips falsy entry in oldSecrets when main secret does not match', () => {
      const MAIN = 'main-secret'
      const OLD = 'old-secret'
      const ctx = {
        options: {
          cookie: {secret: MAIN, oldSecrets: ['', OLD]},
          signWith: undefined,
        },
        req: {},
        debug: undefined,
      }
      const sessionId = 'test-session-id'

      // Sign with OLD so MAIN doesn't match → loop hits '' → continue (covered) → OLD matches
      const oldCtx = {...ctx, options: {...ctx.options, cookie: {...ctx.options.cookie, secret: OLD}}}
      const sig = createSignature(oldCtx, sessionId, OLD)
      const cookie = `${sessionId}.${sig}`

      const result = verifySessionId(ctx, cookie)
      assert.strictEqual(result, sessionId)
    })
  })
})
