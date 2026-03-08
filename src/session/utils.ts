import type {
  SessionContext,
  SessionRawData,
  SessionRedirectData,
  SessionRedirectRef,
  SessionStoreData,
  ValidatedSessionMiddlewareOptions
} from "../types/types.js";
import crypto from "node:crypto";

export const updatePreviousSession = async (
  validatedOptions: ValidatedSessionMiddlewareOptions,
  previous: SessionRedirectRef,
) => {

  if (validatedOptions.store.merge) {
    await validatedOptions.store.merge(previous.id, {
      data: null,
      meta: {
        redirectTo: previous.redirectTo
      },
    }, validatedOptions.rotation.gracePeriod)
  } else {
    await validatedOptions.store.set(previous.id, {
      data: null,
      meta: {
        redirectTo: previous.redirectTo
      },
    }, validatedOptions.rotation.gracePeriod)
  }
}

export const isSessionRedirectData = (data: SessionStoreData): data is SessionRedirectData => {
  return data.data === null && 'redirectTo' in data.meta
}

export const createSessionRawData = <T>(ctx: SessionContext, sessionId: string): SessionRawData<T> => {
  ctx.isNew = true
  return {
    meta: {
      expiresAt: 0,
      id: sessionId,
      createdAt: Date.now(),
    },
    data: {} as T,
  }
}

export const generateId = () => crypto.randomBytes(32).toString('hex')
