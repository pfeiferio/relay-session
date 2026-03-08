import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import {
  checkBoolean,
  checkFunction,
  checkNonEmptyString,
  checkPositiveInteger,
  isBoolean,
  isFunction,
  isPositiveInteger,
} from '../dist/validations/checks.js'

describe('checks', () => {

  describe('isPositiveInteger()', () => {
    it('returns false for a non-number (string)', () => {
      assert.strictEqual(isPositiveInteger('5'), false)
    })
    it('returns false for undefined', () => {
      assert.strictEqual(isPositiveInteger(undefined), false)
    })
    it('returns false for 0 (value <= 0)', () => {
      assert.strictEqual(isPositiveInteger(0), false)
    })
    it('returns false for a negative number', () => {
      assert.strictEqual(isPositiveInteger(-1), false)
    })
    it('returns false for a positive float (not an integer)', () => {
      assert.strictEqual(isPositiveInteger(1.5), false)
    })
    it('returns true for a positive integer', () => {
      assert.strictEqual(isPositiveInteger(1), true)
      assert.strictEqual(isPositiveInteger(1000), true)
    })
  })

  describe('checkPositiveInteger()', () => {
    it('does not throw for a positive integer', () => {
      assert.doesNotThrow(() => checkPositiveInteger(42, 'field'))
    })
    it('throws SessionConfigError for a non-positive-integer', () => {
      assert.throws(() => checkPositiveInteger(0, 'field'), {name: 'SessionConfigError'})
      assert.throws(() => checkPositiveInteger('x', 'field'), {name: 'SessionConfigError'})
    })
  })

  describe('isBoolean()', () => {
    it('returns true for booleans', () => {
      assert.strictEqual(isBoolean(true), true)
      assert.strictEqual(isBoolean(false), true)
    })
    it('returns false for non-booleans', () => {
      assert.strictEqual(isBoolean(1), false)
      assert.strictEqual(isBoolean('true'), false)
    })
  })

  describe('checkBoolean()', () => {
    it('does not throw for a boolean', () => {
      assert.doesNotThrow(() => checkBoolean(true, 'field'))
    })
    it('throws for a non-boolean', () => {
      assert.throws(() => checkBoolean(1, 'field'), {name: 'SessionConfigError'})
    })
  })

  describe('isFunction()', () => {
    it('returns true for a function', () => {
      assert.strictEqual(isFunction(() => {
      }), true)
    })
    it('returns false for a non-function', () => {
      assert.strictEqual(isFunction(42), false)
    })
  })

  describe('checkFunction()', () => {
    it('does not throw for a function', () => {
      assert.doesNotThrow(() => checkFunction(() => {
      }, 'field'))
    })
    it('throws for a non-function', () => {
      assert.throws(() => checkFunction(null, 'field'), {name: 'SessionConfigError'})
    })
  })

  describe('checkNonEmptyString()', () => {
    it('does not throw for a non-empty string', () => {
      assert.doesNotThrow(() => checkNonEmptyString('hello', 'field'))
    })
    it('throws for empty string', () => {
      assert.throws(() => checkNonEmptyString('', 'field'), {name: 'SessionConfigError'})
    })
    it('throws for non-string', () => {
      assert.throws(() => checkNonEmptyString(42, 'field'), {name: 'SessionConfigError'})
    })
    it('throws for null', () => {
      assert.throws(() => checkNonEmptyString(null, 'field'), {name: 'SessionConfigError'})
    })
  })
})
