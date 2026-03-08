import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import {createProxy} from '../dist/utils/createProxy.js'

describe('createProxy', () => {

  describe('dirty path tracking — objects', () => {
    it('marks a top-level property as dirty on set', () => {
      const {proxy, getDirtyPaths} = createProxy({name: 'alice'})
      proxy.name = 'bob'
      assert.deepStrictEqual([...getDirtyPaths()], ['name'])
    })

    it('marks a nested property as dirty with dot-separated path', () => {
      const {proxy, getDirtyPaths} = createProxy({user: {name: 'alice'}})
      proxy.user.name = 'bob'
      assert.deepStrictEqual([...getDirtyPaths()], ['user.name'])
    })

    it('deduplicates: child path is removed when a parent becomes dirty', () => {
      const {proxy, getDirtyPaths} = createProxy({user: {name: 'alice', age: 30}})
      proxy.user.name = 'bob'       // marks 'user.name'
      proxy.user = {name: 'eve'}  // marks 'user' → 'user.name' should be removed
      assert.deepStrictEqual([...getDirtyPaths()], ['user'])
    })

    it('deduplicates: setting a child of an already-dirty parent does not add child', () => {
      const {proxy, getDirtyPaths} = createProxy({user: {name: 'alice'}})
      proxy.user = {name: 'bob'}  // marks 'user'
      proxy.user.name = 'eve'       // parent 'user' already dirty → 'user.name' not added
      assert.deepStrictEqual([...getDirtyPaths()], ['user'])
    })
  })

  // ─────────────────────────────────────────────
  describe('dirty path tracking — arrays', () => {
    it('marks the array path (not an index) dirty when an element is set', () => {
      const {proxy, getDirtyPaths} = createProxy({tags: ['a', 'b']})
      proxy.tags[0] = 'x'
      assert.deepStrictEqual([...getDirtyPaths()], ['tags'])
    })

    it('marks the array dirty on push()', () => {
      const {proxy, getDirtyPaths} = createProxy({tags: ['a']})
      proxy.tags.push('b')
      assert.deepStrictEqual([...getDirtyPaths()], ['tags'])
    })

    it('marks the array dirty on pop()', () => {
      const {proxy, getDirtyPaths} = createProxy({tags: ['a', 'b']})
      proxy.tags.pop()
      assert.deepStrictEqual([...getDirtyPaths()], ['tags'])
    })

    it('marks the array dirty on splice()', () => {
      const {proxy, getDirtyPaths} = createProxy({items: [1, 2, 3]})
      proxy.items.splice(1, 1)
      assert.deepStrictEqual([...getDirtyPaths()], ['items'])
    })

    it('marks the array dirty on sort()', () => {
      const {proxy, getDirtyPaths} = createProxy({nums: [3, 1, 2]})
      proxy.nums.sort()
      assert.deepStrictEqual([...getDirtyPaths()], ['nums'])
    })
  })

  // ─────────────────────────────────────────────
  describe('dirty path tracking — deleteProperty', () => {
    it('marks a property as dirty when deleted', () => {
      const {proxy, getDirtyPaths} = createProxy({a: 1, b: 2})
      delete proxy.a
      assert.deepStrictEqual([...getDirtyPaths()], ['a'])
    })

    it('marks a nested property as dirty when deleted', () => {
      const {proxy, getDirtyPaths} = createProxy({user: {name: 'alice', role: 'admin'}})
      delete proxy.user.role
      assert.deepStrictEqual([...getDirtyPaths()], ['user.role'])
    })
  })

  // ─────────────────────────────────────────────
  describe('clearDirty()', () => {
    it('clears all tracked dirty paths', () => {
      const {proxy, getDirtyPaths, clearDirty} = createProxy({a: 1, b: 2})
      proxy.a = 10
      proxy.b = 20
      assert.strictEqual(getDirtyPaths().size, 2)
      clearDirty()
      assert.strictEqual(getDirtyPaths().size, 0)
    })
  })

  // ─────────────────────────────────────────────
  describe('proxy cache — nested object path (prefix truthy branch)', () => {
    it('wraps a nested object with the correct prefix when accessed from a non-root level', () => {
      // proxy.a → prefix='', prop='a' → false branch: path = 'a'
      // proxy.a.b → prefix='a', prop='b' → TRUE branch: path = 'a.b'  ← line 57 true branch
      const {proxy, getDirtyPaths} = createProxy({a: {b: {c: 1}}})
      proxy.a.b.c = 99
      assert.deepStrictEqual([...getDirtyPaths()], ['a.b.c'])
    })
  })

  // ─────────────────────────────────────────────
  describe('data reference', () => {
    it('data field points to the original object (not the proxy)', () => {
      const original = {x: 1}
      const {data, proxy} = createProxy(original)
      proxy.x = 99
      assert.strictEqual(data.x, 99, 'original object is mutated through the proxy')
      assert.strictEqual(data, original)
    })
  })
})
