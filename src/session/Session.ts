import {createProxy, type ProxyWithTracking} from "../utils/createProxy.js";
import type {
  SessionContext,
  SessionMeta,
  SessionRawData,
  SessionStoreAdapter,
  SessionStoreData,
  ValidatedSessionMiddlewareOptions
} from "../types/types.js";
import {getValueByPath, setMultipleValuesByPaths} from "@pfeiferio/dotpath-utils";
import {createSessionRawData, generateId, updatePreviousSession} from "./utils.js";
import {tryLock, waitForUnlock} from "./lock-utils.js";
import {injectTools} from "../utils/injectTools.js";

export class Session<T extends Record<string, unknown>> {

  readonly #tracking: ProxyWithTracking<SessionRawData<T>>
  readonly #store: SessionStoreAdapter
  readonly #options: ValidatedSessionMiddlewareOptions
  readonly #onDestroy: () => void
  readonly #onRotateId: (sessionId: string) => void
  #redirectTo?: Session<T>
  readonly #ctx: SessionContext

  constructor(
    ctx: SessionContext,
    rawData: SessionRawData<T>,
    onDestroy: () => void,
    onRotateId: (sessionId: string) => void,
  ) {
    if (!rawData.meta.createdAt) rawData.meta.createdAt = Date.now()
    if (!rawData.meta.expiresAt) rawData.meta.expiresAt = Date.now() + ctx.options.cookie.ttl

    this.#tracking = createProxy(rawData)
    this.#store = ctx.options.store
    this.#options = ctx.options
    this.#onDestroy = onDestroy
    this.#onRotateId = onRotateId
    this.#ctx = ctx
  }

  maxAge(ttl: number) {
    this.#meta.expiresAt = Date.now() + ttl
    return this
  }

  toJSON() {
    return {
      raw: this.raw,
      isRedirected: this.isRedirected,
      isNew: this.isNew
    }
  }

  get isRedirected() {
    return this.#ctx.isRedirected === true
  }

  get id() {
    return this.#meta.id
  }

  get expiresAt() {
    return this.#tracking.proxy.meta.expiresAt
  }

  get createdAt() {
    return this.#tracking.proxy.meta.createdAt
  }

  get data() {
    return this.#tracking.proxy.data
  }

  set data(value: T) {
    this.#tracking.proxy.data = value ?? {} as T
  }

  get #meta(): SessionMeta {
    return this.#tracking.proxy.meta
  }

  clearDirty() {
    return this.#tracking.clearDirty()
  }

  getDirtyPaths(): Set<string> {
    return this.#tracking.getDirtyPaths()
  }

  async save(): Promise<void> {
    !this.#isLockOwner && await waitForUnlock(this.#store, this.id, this.#ctx.options.lock)

    if (this.#redirectTo) {
      this.#ctx.debug?.(`save redirect | id=${this.id} delegating to id=${this.#redirectTo.id}`)
      await this.#redirectTo.save()
      await updatePreviousSession(this.#options, {
        id: this.id,
        redirectTo: this.#redirectTo.id
      })
      this.clearDirty()
      return
    }

    const dirty = this.getDirtyPaths()
    if (!dirty.size) {
      this.#ctx.debug?.(`save skip | id=${this.id} no dirty paths`)
      return
    }

    this.#ctx.debug?.(`save | id=${this.id} dirtyPaths=${[...dirty].join(', ')}`)

    const changedPaths: Record<string, unknown> = {}
    dirty.forEach(path => changedPaths[path] = getValueByPath(this.#tracking.data, path))

    const isNew = this.isNew

    if (!isNew && this.#store.merge) {
      this.#ctx.debug?.(`save merge | id=${this.id}`)
      await this.#store.merge(this.id, changedPaths, this.#options.cookie.ttl)
    } else {
      this.#ctx.debug?.(`save set | id=${this.id} isNew=${isNew}`)
      const stored =
        (isNew ?
            this.#tracking.data
            : await this.#store.get(this.id) ?? createSessionRawData(this.#ctx, this.id)
        ) as SessionStoreData

      delete this.#ctx.isNew

      const merged = setMultipleValuesByPaths(stored, changedPaths) as SessionStoreData
      await this.#store.set(this.id, merged, this.#options.cookie.ttl)
    }

    this.clearDirty()
  }

  async destroy(): Promise<void> {
    this.#ctx.debug?.(`destroy | id=${this.id}`)
    await this.#store.delete(this.id)
    this.#onDestroy()
  }

  get isNew(): boolean {
    return this.#ctx.isNew === true
  }

  #isLockOwner = false

  async lock(): Promise<void> {
    !this.#isLockOwner && await tryLock(this.#store, this.id, this.#ctx.options.lock)
    this.#isLockOwner = true
  }

  async unlock(): Promise<boolean> {
    if (!this.#isLockOwner) return false
    this.#isLockOwner = false
    if (!this.#store.unlock) return true
    await this.#store.unlock(this.id)
    return true
  }

  async withLock<R>(fn: () => R | Promise<R>): Promise<R> {
    await this.lock()
    try {
      return await fn()
    } finally {
      await this.unlock()
    }
  }

  get isLockOwner(): boolean {
    return this.#isLockOwner
  }

  async rotateId() {
    this.#ctx.debug?.(`rotateId | wait for unlock`)
    !this.#isLockOwner && await waitForUnlock(this.#store, this.id, this.#ctx.options.lock)
    const oldId = this.id
    const rotatedRaw = {...this.#tracking.data} as SessionRawData<T>
    rotatedRaw.meta = {...rotatedRaw.meta}
    rotatedRaw.meta.id = generateId()

    this.#ctx.debug?.(`rotateId | old=${oldId} new=${rotatedRaw.meta.id}`)

    const ctxNew = {
      isNew: false,        // nicht neu — Daten existieren bereits
      isRedirected: false, // nicht über Redirect geladen — frisch rotiert
      depth: 0,
      req: this.#ctx.req,
      res: this.#ctx.res,
      options: this.#ctx.options
    }

    injectTools(ctxNew)

    const newSession = new Session(ctxNew, rotatedRaw, this.#onDestroy, this.#onRotateId)
    await this.#store.set(rotatedRaw.meta.id, rotatedRaw as SessionStoreData, this.#options.cookie.ttl)

    this.#redirectTo = newSession
    this.#tracking.proxy.data = newSession.data
    this.#meta.redirectTo = newSession.id
    this.#onRotateId(rotatedRaw.meta.id)
  }

  get raw() {
    return this.#tracking.proxy
  }
}
