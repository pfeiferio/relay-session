import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import {validateOptions} from '../dist/validations/validateOptions.js'

const noop = () => {
}

const makeStore = (extra = {}) => ({get: noop, set: noop, delete: noop, ...extra})

const validDefaults = {
  debug: false,
  autoSave: false,
  rolling: false,
  store: makeStore(),
  cookie: {
    name: 'sid',
    secret: 'supersecret',
    ttl: 60_000,
    secure: true,
    sameSite: 'strict',
    httpOnly: true,
    oldSecrets: [],
    cookieReader: noop,
  },
  shutdown: {waitTimeout: 30_000},
  lock: {ttl: 5_000, retries: 10, backoff: 50},
  onUnlockError: noop,
  onAutoSaveError: noop,
  onBrokenChain: noop,
  rotation: {gracePeriod: undefined},
}

const validOptions = {
  store: makeStore(),
  cookie: {name: 'sid', secret: 'supersecret', ttl: 60_000},
}

function call(optionsPatch = {}, defaultsPatch = {}) {
  const opts = {...validOptions, ...optionsPatch}
  if (optionsPatch.cookie !== undefined) opts.cookie = {...validOptions.cookie, ...optionsPatch.cookie}
  const defs = {...validDefaults, ...defaultsPatch}
  if (defaultsPatch.cookie !== undefined) defs.cookie = {...validDefaults.cookie, ...defaultsPatch.cookie}
  return validateOptions(opts, defs)
}

function throws(fn, msgPart) {
  assert.throws(fn, (err) => {
    assert.strictEqual(err.name, 'SessionConfigError', `Expected SessionConfigError, got ${err.name}`)
    assert.ok(err.message.includes(msgPart), `Expected "${msgPart}" in: "${err.message}"`)
    return true
  })
}

describe('validateOptions', () => {
  it('returns validated options for a valid input', () => {
    const result = call()
    assert.strictEqual(result.cookie.name, 'sid')
    assert.strictEqual(result.cookie.secret, 'supersecret')
    assert.strictEqual(result.cookie.ttl, 60_000)
    assert.strictEqual(result.rolling, false)
    assert.strictEqual(result.autoSave, false)
    assert.strictEqual(result.debug, null)
    assert.deepStrictEqual(result.cookie.oldSecrets, [])
    assert.strictEqual(result.rotation.gracePeriod, 60_000) // defaults to ttl
    assert.strictEqual(result.signWith, undefined)
  })

  describe('lock', () => {
    it('throws if lock.ttl is not a positive integer', () => {
      throws(() => call({}, {lock: {ttl: 0, retries: 10, backoff: 50}}), 'lock.ttl')
      throws(() => call({}, {lock: {ttl: -1, retries: 10, backoff: 50}}), 'lock.ttl')
      throws(() => call({}, {lock: {ttl: 1.5, retries: 10, backoff: 50}}), 'lock.ttl')
    })

    it('throws if lock.retries is not a positive integer', () => {
      throws(() => call({}, {lock: {ttl: 5_000, retries: 0, backoff: 50}}), 'lock.retries')
      throws(() => call({}, {lock: {ttl: 5_000, retries: -1, backoff: 50}}), 'lock.retries')
    })

    it('throws if lock.backoff is not a positive integer', () => {
      throws(() => call({}, {lock: {ttl: 5_000, retries: 10, backoff: 0}}), 'lock.backoff')
      throws(() => call({}, {lock: {ttl: 5_000, retries: 10, backoff: 1.5}}), 'lock.backoff')
    })

    it('accepts valid lock options', () => {
      assert.doesNotThrow(() => call({}, {lock: {ttl: 1, retries: 1, backoff: 1}}))
    })
  })

  describe('signWith', () => {
    it('throws if signWith is not a function', () => {
      throws(() => call({signWith: 'bad'}), 'signWith')
      throws(() => call({signWith: 42}), 'signWith')
    })

    it('accepts a function', () => {
      const result = call({signWith: () => 'key'})
      assert.strictEqual(typeof result.signWith, 'function')
    })

    it('is optional — undefined is passed through', () => {
      const result = call()
      assert.strictEqual(result.signWith, undefined)
    })
  })

  describe('shutdown', () => {
    it('throws if waitTimeout is set without registry', () => {
      throws(() => call({shutdown: {waitTimeout: 5_000}}), 'shutdown.waitTimeout')
    })

    it('throws if registry is not a ShutdownRegistry-like object', () => {
      throws(() => call({shutdown: {registry: {}}}), 'shutdown.registry')
      throws(() => call({shutdown: {registry: {shutdown: noop}}}), 'shutdown.registry') // missing register
      throws(() => call({shutdown: {registry: {register: noop}}}), 'shutdown.registry') // missing shutdown
      throws(() => call({shutdown: {registry: 'bad'}}), 'shutdown.registry')
    })

    it('throws if waitTimeout is not a positive integer when registry is set', () => {
      const registry = {shutdown: noop, register: noop}
      throws(() => call({shutdown: {registry, waitTimeout: 0}}), 'shutdown.waitTimeout')
      throws(() => call({shutdown: {registry, waitTimeout: -1}}), 'shutdown.waitTimeout')
    })

    it('accepts a valid registry with waitTimeout', () => {
      const registry = {shutdown: noop, register: noop}
      assert.doesNotThrow(() => call({shutdown: {registry, waitTimeout: 5_000}}))
    })

    it('uses the default waitTimeout if not provided with registry', () => {
      const registry = {shutdown: noop, register: noop}
      const result = call({shutdown: {registry}})
      assert.strictEqual(result.shutdown.waitTimeout, 30_000)
    })
  })

  describe('debug', () => {
    it('throws if debug is not a boolean or function', () => {
      throws(() => call({debug: 'yes'}), 'debug')
      throws(() => call({debug: 42}), 'debug')
    })

    it('converts true to a wrapped console.debug function and calls it', () => {
      const messages = []
      const orig = console.debug
      console.debug = (msg) => messages.push(msg)
      try {
        const result = call({debug: true})
        assert.strictEqual(typeof result.debug, 'function')
        result.debug('test-msg')  // exercises the (msg) => console.debug(msg) body
        assert.ok(messages.some(m => m.includes('test-msg')))
      } finally {
        console.debug = orig
      }
    })

    it('converts false to null', () => {
      const result = call({debug: false})
      assert.strictEqual(result.debug, null)
    })

    it('wraps a custom function and prefixes log messages', () => {
      const messages = []
      const result = call({debug: (msg) => messages.push(msg)})
      assert.strictEqual(typeof result.debug, 'function')
      result.debug('hello')
      assert.strictEqual(messages.length, 1)
      assert.ok(messages[0].includes('[debug-session]'))
      assert.ok(messages[0].includes('hello'))
    })
  })

  describe('autoSave', () => {
    it('throws if autoSave is not a boolean', () => {
      throws(() => call({autoSave: 1}), 'autoSave')
      throws(() => call({autoSave: 'true'}), 'autoSave')
    })

    it('accepts true and false', () => {
      assert.doesNotThrow(() => call({autoSave: true}))
      assert.doesNotThrow(() => call({autoSave: false}))
    })
  })

  describe('rolling', () => {
    it('throws if rolling is not a boolean or number', () => {
      throws(() => call({rolling: 'yes'}), 'rolling')
      throws(() => call({rolling: {}}), 'rolling')
    })

    it('throws if rolling is a number outside the exclusive range (0, 1)', () => {
      throws(() => call({rolling: 0}), 'rolling')
      throws(() => call({rolling: 1}), 'rolling')
      throws(() => call({rolling: 1.5}), 'rolling')
      throws(() => call({rolling: -0.1}), 'rolling')
    })

    it('accepts boolean values', () => {
      assert.doesNotThrow(() => call({rolling: true}))
      assert.doesNotThrow(() => call({rolling: false}))
    })

    it('accepts a fractional number within (0, 1)', () => {
      assert.doesNotThrow(() => call({rolling: 0.5}))
      assert.doesNotThrow(() => call({rolling: 0.1}))
      assert.doesNotThrow(() => call({rolling: 0.9}))
    })
  })

  describe('cookie.name', () => {
    it('throws if cookie.name is empty or not a string', () => {
      throws(() => call({cookie: {name: ''}}), 'cookie.name')
      throws(() => call({cookie: {name: 42}}), 'cookie.name')
    })
  })

  describe('cookie.secret', () => {
    it('throws if cookie.secret is empty or not a string', () => {
      throws(() => call({cookie: {secret: ''}}), 'cookie.secret')
      throws(() => call({cookie: {secret: 42}}), 'cookie.secret')
    })
  })

  describe('cookie.ttl', () => {
    it('throws if cookie.ttl is not a positive integer', () => {
      throws(() => call({cookie: {ttl: 0}}), 'cookie.ttl')
      throws(() => call({cookie: {ttl: -1000}}), 'cookie.ttl')
      throws(() => call({cookie: {ttl: 1.5}}), 'cookie.ttl')
    })

    it('accepts a positive integer', () => {
      assert.doesNotThrow(() => call({cookie: {ttl: 5_000}}))
    })
  })

  describe('cookie.sameSite', () => {
    it('throws if sameSite is an invalid value', () => {
      throws(() => call({}, {cookie: {sameSite: 'invalid'}}), 'cookie.sameSite')
      throws(() => call({}, {cookie: {sameSite: undefined}}), 'cookie.sameSite')
    })

    it('accepts strict, lax, and none (with secure=true)', () => {
      assert.doesNotThrow(() => call({}, {cookie: {sameSite: 'strict'}}))
      assert.doesNotThrow(() => call({}, {cookie: {sameSite: 'lax'}}))
      assert.doesNotThrow(() => call({cookie: {secure: true}}, {cookie: {sameSite: 'none', secure: true}}))
    })

    it('throws if sameSite is "none" but secure is false', () => {
      throws(
        () => call({cookie: {secure: false}}, {cookie: {sameSite: 'none'}}),
        'cookie.secure'
      )
    })
  })

  describe('store', () => {
    it('throws if store is not an object', () => {
      // null and undefined fall back to the default via ??, so we test via defaults
      throws(() => validateOptions({cookie: validOptions.cookie}, {...validDefaults, store: null}), 'store')
      throws(() => call({store: 'bad'}), 'store')
      throws(() => call({store: 42}), 'store')
    })

    it('throws if store.get is missing or not a function', () => {
      throws(() => call({store: {set: noop, delete: noop}}), 'store.get')
      throws(() => call({store: {get: 'x', set: noop, delete: noop}}), 'store.get')
    })

    it('throws if store.set is missing or not a function', () => {
      throws(() => call({store: {get: noop, delete: noop}}), 'store.set')
    })

    it('throws if store.delete is missing or not a function', () => {
      throws(() => call({store: {get: noop, set: noop}}), 'store.delete')
    })

    it('throws if only some of lock/unlock/isLocked are implemented', () => {
      throws(() => call({store: makeStore({lock: noop})}), 'lock, unlock, isLocked')
      throws(() => call({store: makeStore({lock: noop, unlock: noop})}), 'lock, unlock, isLocked')
      throws(() => call({store: makeStore({unlock: noop, isLocked: noop})}), 'lock, unlock, isLocked')
    })

    it('accepts a store with no lock methods', () => {
      assert.doesNotThrow(() => call({store: makeStore()}))
    })

    it('accepts a store with all three lock methods', () => {
      assert.doesNotThrow(() => call({store: makeStore({lock: noop, unlock: noop, isLocked: noop})}))
    })
  })

  describe('cookie.secure', () => {
    it('throws if secure is not a boolean', () => {
      throws(() => call({cookie: {secure: 1}}), 'cookie.secure')
      throws(() => call({cookie: {secure: 'true'}}), 'cookie.secure')
    })
  })

  describe('cookie.httpOnly', () => {
    it('throws if httpOnly is not a boolean', () => {
      throws(() => call({}, {cookie: {httpOnly: 'yes'}}), 'cookie.httpOnly')
      throws(() => call({}, {cookie: {httpOnly: 1}}), 'cookie.httpOnly')
    })
  })

  describe('cookie.oldSecrets', () => {
    it('throws if oldSecrets is not an array', () => {
      throws(() => call({}, {cookie: {oldSecrets: 'secret'}}), 'cookie.oldSecrets')
      throws(() => call({}, {cookie: {oldSecrets: null}}), 'cookie.oldSecrets')
    })

    it('throws if oldSecrets contains non-string or empty values', () => {
      throws(() => call({}, {cookie: {oldSecrets: [123]}}), 'cookie.oldSecrets')
      throws(() => call({}, {cookie: {oldSecrets: ['']}}), 'cookie.oldSecrets')
      throws(() => call({}, {cookie: {oldSecrets: ['valid', '']}}), 'cookie.oldSecrets')
    })

    it('throws if oldSecrets contains the current secret', () => {
      throws(
        () => call({cookie: {secret: 'mysecret'}}, {cookie: {oldSecrets: ['mysecret']}}),
        'cookie.oldSecrets'
      )
    })

    it('accepts valid oldSecrets', () => {
      assert.doesNotThrow(() => call({}, {cookie: {oldSecrets: ['old1', 'old2']}}))
    })
  })

  describe('rotation.gracePeriod', () => {
    it('defaults to cookie.ttl when not set', () => {
      const result = call({cookie: {ttl: 30_000}})
      assert.strictEqual(result.rotation.gracePeriod, 30_000)
    })

    it('throws if gracePeriod is less than 5000ms', () => {
      throws(() => call({cookie: {ttl: 60_000}, rotation: {gracePeriod: 4_999}}), 'rotation.gracePeriod')
      throws(() => call({cookie: {ttl: 60_000}, rotation: {gracePeriod: 1}}), 'rotation.gracePeriod')
    })

    it('throws if gracePeriod exceeds cookie.ttl', () => {
      throws(() => call({cookie: {ttl: 60_000}, rotation: {gracePeriod: 60_001}}), 'rotation.gracePeriod')
      throws(() => call({cookie: {ttl: 10_000}, rotation: {gracePeriod: 30_000}}), 'rotation.gracePeriod')
    })

    it('accepts a valid gracePeriod', () => {
      assert.doesNotThrow(() => call({cookie: {ttl: 60_000}, rotation: {gracePeriod: 5_000}}))
      assert.doesNotThrow(() => call({cookie: {ttl: 60_000}, rotation: {gracePeriod: 60_000}}))
    })
  })

  describe('cookie.cookieReader', () => {
    it('throws if cookieReader is not a function', () => {
      throws(() => call({cookie: {cookieReader: 'bad'}}), 'cookie.cookieReader')
      throws(() => call({cookie: {cookieReader: 42}}), 'cookie.cookieReader')
    })

    it('accepts a function', () => {
      const reader = () => ({})
      const result = call({cookie: {cookieReader: reader}})
      assert.strictEqual(result.cookie.cookieReader, reader)
    })

    it('is optional — undefined skips validation', () => {
      assert.doesNotThrow(() => call({cookie: {cookieReader: undefined}}))
    })
  })

  describe('onBrokenChain / onUnlockError / onAutoSaveError', () => {
    it('throws if onBrokenChain is not a function', () => {
      throws(() => call({}, {onBrokenChain: 'bad'}), 'onBrokenChain')
    })

    it('throws if onUnlockError is not a function', () => {
      throws(() => call({}, {onUnlockError: 'bad'}), 'onUnlockError')
    })

    it('throws if onAutoSaveError is not a function', () => {
      throws(() => call({}, {onAutoSaveError: 'bad'}), 'onAutoSaveError')
    })
  })
})
