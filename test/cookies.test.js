import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import {delCookie, setCookie} from '../dist/cookies/cookies.js'

function makeRes() {
  const headers = []
  return {
    appendHeader(name, value) {
      headers.push({name, value})
    },
    _headers: headers,
    _cookie() {
      return headers.find(h => h.name === 'Set-Cookie')?.value ?? null
    },
  }
}

function makeOptions(overrides = {}) {
  return {
    name: 'sid',
    ttl: 60_000,
    httpOnly: false,
    secure: false,
    sameSite: 'lax',
    ...overrides,
  }
}

describe('cookies', () => {

  describe('setCookie()', () => {
    it('sets a basic cookie with name, value, path, and max-age', () => {
      const res = makeRes()
      setCookie(res, makeOptions(), 'my-session-id')

      const cookie = res._cookie()
      assert.ok(cookie, 'Set-Cookie header should be set')
      assert.ok(cookie.includes('sid=my-session-id'), 'should contain name=value')
      assert.ok(cookie.includes('Path=/'), 'should include Path=/')
      assert.ok(cookie.includes('Max-Age=60'), 'should include Max-Age in seconds')
    })

    it('URL-encodes the cookie value', () => {
      const res = makeRes()
      setCookie(res, makeOptions(), 'abc.def+ghi')

      const cookie = res._cookie()
      assert.ok(cookie.includes('sid=abc.def%2Bghi') || cookie.includes(encodeURIComponent('abc.def+ghi')))
    })

    it('includes HttpOnly when httpOnly is true', () => {
      const res = makeRes()
      setCookie(res, makeOptions({httpOnly: true}), 'val')

      assert.ok(res._cookie().includes('HttpOnly'), 'should include HttpOnly flag')
    })

    it('omits HttpOnly when httpOnly is false', () => {
      const res = makeRes()
      setCookie(res, makeOptions({httpOnly: false}), 'val')

      assert.ok(!res._cookie().includes('HttpOnly'), 'should not include HttpOnly flag')
    })

    it('includes Secure when secure is true', () => {
      const res = makeRes()
      setCookie(res, makeOptions({secure: true}), 'val')

      assert.ok(res._cookie().includes('Secure'), 'should include Secure flag')
    })

    it('omits Secure when secure is false', () => {
      const res = makeRes()
      setCookie(res, makeOptions({secure: false}), 'val')

      assert.ok(!res._cookie().includes('Secure'), 'should not include Secure flag')
    })

    it('capitalises sameSite correctly', () => {
      const res = makeRes()
      setCookie(res, makeOptions({sameSite: 'strict'}), 'val')

      assert.ok(res._cookie().includes('SameSite=Strict'), 'should capitalise sameSite')
    })

    it('sets Max-Age to 0 when ttl is 0', () => {
      const res = makeRes()
      setCookie(res, makeOptions({ttl: 0}), '')

      assert.ok(res._cookie().includes('Max-Age=0'), 'Max-Age should be 0')
    })
  })

  describe('delCookie()', () => {
    it('sets a Set-Cookie header with Max-Age=0 to delete the cookie', () => {
      const res = makeRes()
      delCookie(res, makeOptions())

      const cookie = res._cookie()
      assert.ok(cookie, 'Set-Cookie header should be set')
      assert.ok(cookie.includes('Max-Age=0'), 'Max-Age should be 0 to expire the cookie')
      assert.ok(cookie.includes('sid='), 'should include cookie name')
    })

    it('uses the provided options name', () => {
      const res = makeRes()
      delCookie(res, makeOptions({name: 'mysession'}))

      assert.ok(res._cookie().includes('mysession='), 'should use the cookie name from options')
    })
  })
})
