import type {Request, RequestHandler, Response} from 'express'
import type {ShutdownRegistry} from 'request-drain'

export type ContextTools = {
  setSessionCookieIfNeeded(): void
}

export type SessionCookieOptions = {
  name: string
  secret: string
  oldSecrets?: string[]
  ttl: number
  secure?: boolean
  sameSite?: 'strict' | 'lax' | 'none'
  httpOnly?: boolean
  cookieReader?: (req: Request, cookieName: string) => Record<string, string>
}

export type SessionContext = {
  tools: ContextTools
  res: Response
  req: Request
  depth: number
  isRedirected?: boolean
  isNew?: boolean
  previous?: SessionRedirectRef
  debug?: (msg: string) => void
  options: ValidatedSessionMiddlewareOptions
}

export type SessionRotationOptions = {
  gracePeriod?: number
}

export type SessionStoreData = SessionRawData<Record<string, unknown>> | SessionRedirectData

export type SessionLockOptions = {
  ttl?: number
  retries?: number
  backoff?: number
}

export type ValidatedSessionLockOptions = {
  ttl: number
  retries: number
  backoff: number
}

export type SessionStoreAdapter = {
  get(sessionId: string): Promise<SessionStoreData | null> | SessionStoreData | null
  set(sessionId: string, data: SessionStoreData, ttlMs: number): Promise<void> | void
  delete(sessionId: string): Promise<void> | void
  merge?(sessionId: string, paths: Record<string, unknown>, ttlMs: number): Promise<void> | void

  /**
   * Attempts to acquire a lock for the given session.
   * MUST be implemented atomically — check and set in one operation.
   * Returns true if lock was acquired, false if already locked.
   */
  lock?(sessionId: string, ttlMs: number): Promise<boolean> | boolean
  unlock?(sessionId: string): Promise<void> | void
  isLocked?(sessionId: string): Promise<boolean> | boolean
}

export type SessionMiddlewareOptions = {
  rolling?: boolean | number
  debug?: boolean | ((msg: string) => void)
  cookie: SessionCookieOptions
  store: SessionStoreAdapter
  rotation?: SessionRotationOptions
  autoSave?: boolean
  onBrokenChain?: RequestHandler
  onUnlockError?: (err: unknown, req: Request) => void
  onAutoSaveError?: (err: unknown, req: Request) => void
  lock?: SessionLockOptions
  shutdown?: ShutdownOptions
  signWith?: (req: Request) => string | string[]
}

export type ShutdownOptions = {
  registry: ShutdownRegistry
  waitTimeout?: number
}

export type ValidatedShutdownOptions = {
  registry: ShutdownRegistry | undefined
  waitTimeout: number
}

export type ValidatedSessionCookieOptions = {
  name: string
  secret: string
  oldSecrets: string[]
  ttl: number
  secure: boolean
  sameSite: 'strict' | 'lax' | 'none'
  httpOnly: boolean
  cookieReader: (req: Request, cookieName: string) => Record<string, string> | undefined
}

export type ValidatedSessionRotationOptions = {
  gracePeriod: number
}

export type ValidatedSessionMiddlewareOptions = {
  rolling: boolean | number
  debug: ((msg: string, req?: Request) => void) | null
  cookie: ValidatedSessionCookieOptions
  store: SessionStoreAdapter
  rotation: ValidatedSessionRotationOptions
  autoSave: boolean
  onBrokenChain: RequestHandler
  onAutoSaveError: (err: unknown, req: Request) => void
  onUnlockError: (err: unknown, req: Request) => void
  lock: ValidatedSessionLockOptions
  shutdown: ValidatedShutdownOptions
  signWith: ((req: Request) => string | string[]) | undefined
}

export type SessionMeta = {
  createdAt: number
  expiresAt: number
  id: string
  redirectTo?: string
}

export type SessionRedirectRef = {
  id: string,
  redirectTo: string
}

export type SessionRawData<T> = {
  data: T
  meta: SessionMeta
}

export type SessionRedirectData = {
  meta: {
    redirectTo: string
  }
  data: null
}

export interface SessionData extends Record<string, unknown> {
}
