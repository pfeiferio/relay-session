import type {SessionStoreAdapter, SessionStoreData} from '../types/types.js'
import {setMultipleValuesByPaths} from '@pfeiferio/dotpath-utils'

export const createInMemoryStorage = (): SessionStoreAdapter => {

  const store: Record<string, { data: SessionStoreData, expiresAt: number }> = {}
  const locks: Record<string, number> = {} // sessionId -> expiresAt

  const get = async (sessionId: string): Promise<SessionStoreData | null> => {
    const entry = store[sessionId]
    if (!entry || Date.now() > entry.expiresAt) {
      delete store[sessionId]
      return null
    }
    return entry.data
  }

  const set = async (sessionId: string, data: SessionStoreData, ttlMs: number): Promise<void> => {
    store[sessionId] = {
      expiresAt: Date.now() + ttlMs,
      data
    }
  }

  const merge = async (sessionId: string, paths: Record<string, unknown>, ttlMs: number): Promise<void> => {
    const current = await get(sessionId) ?? {}
    const merged = setMultipleValuesByPaths(current, paths) as SessionStoreData
    await set(sessionId, merged, ttlMs)
  }

  const lock = async (sessionId: string, ttlMs: number): Promise<boolean> => {
    if (locks[sessionId] && Date.now() < locks[sessionId]) {
      return false
    }
    locks[sessionId] = Date.now() + ttlMs
    return true
  }


  const unlock = async (sessionId: string): Promise<void> => {
    delete locks[sessionId]
  }

  const isLocked = async (sessionId: string): Promise<boolean> => {
    const expiresAt = locks[sessionId]
    if (!expiresAt) return false
    if (Date.now() >= expiresAt) {
      delete locks[sessionId]
      return false
    }
    return true
  }

  const deleteStore = async (sessionId: string): Promise<void> => {
    delete store[sessionId]
    delete locks[sessionId]
  }

  return {
    get,
    set,
    merge,
    lock,
    unlock,
    isLocked,
    delete: deleteStore,
  }
}
