import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import {
  isSessionChainBrokenError,
  isSessionChainError,
  isSessionConfigError,
  isSessionDepthError,
  isSessionLockError,
} from '../dist/errors/utils.js'
import {
  SessionChainBrokenError,
  SessionConfigError,
  SessionDepthError,
  SessionLockError,
} from '../dist/errors/index.js'

describe('errors/utils', () => {

  describe('isSessionDepthError()', () => {
    it('returns true for a SessionDepthError instance', () => {
      assert.strictEqual(isSessionDepthError(new SessionDepthError()), true)
    })
    it('returns false for unrelated error', () => {
      assert.strictEqual(isSessionDepthError(new Error('x')), false)
    })
    it('returns false for null', () => {
      assert.strictEqual(isSessionDepthError(null), false)
    })
    it('returns false for a primitive', () => {
      assert.strictEqual(isSessionDepthError('string'), false)
    })
  })

  describe('isSessionChainBrokenError()', () => {
    it('returns true for a SessionChainBrokenError instance', () => {
      assert.strictEqual(isSessionChainBrokenError(new SessionChainBrokenError()), true)
    })
    it('returns false for unrelated error', () => {
      assert.strictEqual(isSessionChainBrokenError(new Error('x')), false)
    })
    it('returns false for null', () => {
      assert.strictEqual(isSessionChainBrokenError(null), false)
    })
  })

  describe('isSessionConfigError()', () => {
    it('returns true for a SessionConfigError instance', () => {
      assert.strictEqual(isSessionConfigError(new SessionConfigError('bad config')), true)
    })
    it('returns false for unrelated error', () => {
      assert.strictEqual(isSessionConfigError(new Error('x')), false)
    })
    it('returns false for null', () => {
      assert.strictEqual(isSessionConfigError(null), false)
    })
  })

  describe('isSessionChainError()', () => {
    it('returns true for a SessionChainBrokenError (is a chain error)', () => {
      assert.strictEqual(isSessionChainError(new SessionChainBrokenError()), true)
    })
    it('returns true for a SessionDepthError (is a chain error)', () => {
      assert.strictEqual(isSessionChainError(new SessionDepthError()), true)
    })
    it('returns false for unrelated error', () => {
      assert.strictEqual(isSessionChainError(new Error('x')), false)
    })
    it('returns false for null', () => {
      assert.strictEqual(isSessionChainError(null), false)
    })
  })

  describe('isSessionLockError()', () => {
    it('returns true for a SessionLockError instance', () => {
      assert.strictEqual(isSessionLockError(new SessionLockError()), true)
    })
    it('returns false for unrelated error', () => {
      assert.strictEqual(isSessionLockError(new Error('x')), false)
    })
    it('returns false for null', () => {
      assert.strictEqual(isSessionLockError(null), false)
    })
  })
})
