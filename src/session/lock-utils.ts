import {SessionLockError} from "../errors/SessionLockError.js";
import type {SessionStoreAdapter, ValidatedSessionLockOptions} from "../types/types.js";

export const waitForUnlock = async (
  store: SessionStoreAdapter,
  sessionId: string,
  options: ValidatedSessionLockOptions
) => {
  await retryUntil(async () => {
      if (!store.isLocked) return true
      if (!await store.isLocked(sessionId)) return true
      return false
    }, () => {
      throw new SessionLockError('session is locked by another request — timeout waiting for unlock')
    }, options
  )
}

export const tryLock = async (
  store: SessionStoreAdapter,
  sessionId: string,
  options: ValidatedSessionLockOptions
) => {

  await retryUntil(async () => {
    if (!store.lock) return true
    if (await store.lock(sessionId, options.ttl)) return true
    return false
  }, () => {
    throw new SessionLockError('session lock could not be acquired — max retries exceeded')
  }, options)
}
const retryUntil = async (
  fnTry: () => Promise<boolean> | boolean,
  fnErr: () => void,
  options: ValidatedSessionLockOptions
): Promise<void> => {
  for (let i = 0; i < options.retries + 1; i++) {
    if (await fnTry()) return
    await new Promise(resolve => setTimeout(resolve, options.backoff * (i + 1)))
  }
  fnErr()
}
