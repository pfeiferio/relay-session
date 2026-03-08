import type {SessionMiddlewareOptions, ValidatedSessionMiddlewareOptions} from '../types/types.js'
import type {Request} from 'express'
import crypto from "node:crypto";
import {checkBoolean, checkFunction, checkNonEmptyString, checkPositiveInteger} from "./checks.js";
import {throwError} from "../errors/SessionConfigError.js";

export const validateOptions = (
  options: SessionMiddlewareOptions,
  defaults: SessionMiddlewareOptions
): ValidatedSessionMiddlewareOptions => {

  function v<G extends keyof ValidatedSessionMiddlewareOptions>(
    group: G
  ): ValidatedSessionMiddlewareOptions[G]
  function v<
    G extends keyof ValidatedSessionMiddlewareOptions,
    K extends keyof ValidatedSessionMiddlewareOptions[G]
  >(
    group: G,
    key: K
  ): ValidatedSessionMiddlewareOptions[G][K]
  function v<
    G extends keyof ValidatedSessionMiddlewareOptions,
    K extends keyof ValidatedSessionMiddlewareOptions[G]
  >(group: G, key?: K | never) {
    if (key === undefined) {
      return options[group] ?? defaults[group]
    }
    return (options[group] as any)?.[key] ?? (defaults[group] as any)[key]
  }

  const rolling = v('rolling')
  const cookieName = v('cookie', 'name')
  const cookieSecret = v('cookie', 'secret')
  const cookieTtl = v('cookie', 'ttl')
  const cookieSecure = v('cookie', 'secure')
  const cookieSameSite = v('cookie', 'sameSite')
  const cookieHttpOnly = v('cookie', 'httpOnly')
  const cookieReader = v('cookie', 'cookieReader')
  let rotationGracePeriod = v('rotation', 'gracePeriod')
  const onBrokenChain = v('onBrokenChain')
  const autoSave = v('autoSave')
  const onAutoSaveError = v('onAutoSaveError')
  const store = v('store')
  const oldSecrets = v('cookie', 'oldSecrets')
  const lockTtl = v('lock', 'ttl')
  const lockRetries = v('lock', 'retries')
  const signWith = v('signWith')
  const lockBackoff = v('lock', 'backoff')
  const shutdownRegistry = options.shutdown?.registry
  let shutdownTimeout = options.shutdown?.waitTimeout
  const onUnlockError = v('onUnlockError')

  checkPositiveInteger(lockTtl, 'lock.ttl')
  checkPositiveInteger(lockRetries, 'lock.retries')
  checkPositiveInteger(lockBackoff, 'lock.backoff')
  signWith !== undefined && checkFunction(signWith, 'signWith')

  if (!shutdownRegistry && shutdownTimeout !== undefined) {
    throwError('"shutdown.waitTimeout" requires "shutdown.registry" to be set')
  }

  if (shutdownRegistry && (
    typeof shutdownRegistry !== 'object' ||
    typeof (shutdownRegistry as any).shutdown !== 'function' ||
    typeof (shutdownRegistry as any).register !== 'function'
  )) {
    throwError('"shutdown.registry" must be a ShutdownRegistry instance')
  }

  shutdownTimeout ??= defaults.shutdown!.waitTimeout
  shutdownRegistry && checkPositiveInteger(shutdownTimeout, 'shutdown.waitTimeout')

  let debug = v('debug') as any

  if (debug === true) {
    debug = (msg: string) => console.debug(msg)
  }

  if (debug !== false && typeof debug !== 'function') {
    throwError('"debug" must be true or a function')
  }

  if (debug) {
    const reqMap: WeakMap<Request, string> = new WeakMap()
    const tmp = debug
    debug = (() => {
      return (msg: string, req?: Request) => {
        const id = !req ? '--unknown--' : reqMap.get(req) ?? crypto.randomUUID()
        if (req) reqMap.set(req, id)
        tmp(`[debug-session] [${id}] msg=${msg}`)
      }
    })();
  } else {
    debug = null
  }

  rotationGracePeriod ??= cookieTtl

  checkFunction(onUnlockError, 'onUnlockError')
  checkFunction(onBrokenChain, 'onBrokenChain')
  checkFunction(onAutoSaveError, 'onAutoSaveError')
  checkBoolean(autoSave, 'autoSave')

  if (typeof rolling !== 'boolean' && typeof rolling !== 'number') {
    throwError('"rolling" must be a boolean or a number between 0 and 1')
  }

  if (typeof rolling === 'number' && (rolling <= 0 || rolling >= 1)) {
    throwError('"rolling" must be between 0 and 1 when a number')
  }

  checkNonEmptyString(cookieName, 'cookie.name')
  checkNonEmptyString(cookieSecret, 'cookie.secret')
  checkPositiveInteger(cookieTtl, 'cookie.ttl')

  if (!cookieSameSite || !['strict', 'lax', 'none'].includes(cookieSameSite)) {
    throwError('"cookie.sameSite" must be "strict", "lax", or "none"')
  }

  if (cookieSameSite === 'none' && !cookieSecure) {
    throwError('"cookie.secure" must be true when "sameSite" is "none"')
  }

  if (!store || typeof store !== 'object') {
    throwError('"store" must be a SessionStoreAdapter')
  }

  checkFunction(store.get, 'store.get')
  checkFunction(store.set, 'store.set')
  checkFunction(store.delete, 'store.delete')

  const lockMembersCount = [store.lock, store.unlock, store.isLocked].filter(Boolean).length

  if (lockMembersCount && lockMembersCount !== 3) {
    throwError('sessionMiddleware: "store" must implement all or none of: lock, unlock, isLocked')
  }

  checkBoolean(cookieSecure, 'cookie.secure')
  checkBoolean(cookieHttpOnly, 'cookie.httpOnly')

  if (!Array.isArray(oldSecrets)) {
    throwError('"cookie.oldSecrets" must be an array')
  }

  if (oldSecrets.some(s => typeof s !== 'string' || !s)) {
    throwError('"cookie.oldSecrets" must contain non-empty strings')
  }

  if (oldSecrets.includes(cookieSecret)) {
    throwError('"cookie.oldSecrets" must not contain the current "cookie.secret"')
  }

  checkPositiveInteger(rotationGracePeriod, 'rotation.gracePeriod')

  if (rotationGracePeriod < 5_000) {
    throwError('"rotation.gracePeriod" must be at least 5000ms')
  }

  if (rotationGracePeriod > cookieTtl) {
    throwError('"rotation.gracePeriod" must not exceed "cookie.ttl"')
  }

  cookieReader !== undefined && checkFunction(cookieReader, 'cookie.cookieReader')

  return {
    signWith,
    rolling,
    shutdown: {
      registry: shutdownRegistry,
      waitTimeout: shutdownTimeout as number
    },
    lock: {
      retries: lockRetries,
      ttl: lockTtl,
      backoff: lockBackoff
    },
    onAutoSaveError,
    onUnlockError,
    debug,
    onBrokenChain,
    store,
    autoSave,
    cookie: {
      oldSecrets,
      name: cookieName,
      secret: cookieSecret,
      ttl: cookieTtl,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      httpOnly: cookieHttpOnly,
      cookieReader,
    },
    rotation: {
      gracePeriod: rotationGracePeriod,
    }
  }
}
