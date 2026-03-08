import './types/express.js';

// Middleware
export {sessionMiddleware} from './session-middleware/sessionMiddleware.js'

// Session class (for typing / assertSession usage)
export type {Session} from './session/Session.js'

// Built-in store
export {createInMemoryStorage} from './utils/createInMemoryStorage.js'

// Type utilities
export {assertSession} from './utils/assertSession.js'

// Errors & type guards
export {
  SessionConfigError,
  SessionChainError,
  SessionChainBrokenError,
  SessionDepthError,
  SessionLockError,
  isSessionConfigError,
  isSessionChainError,
  isSessionChainBrokenError,
  isSessionDepthError,
  isSessionLockError,
} from './errors/index.js'

// Public types
export type {
  SessionMiddlewareOptions,
  SessionCookieOptions,
  SessionRotationOptions,
  SessionLockOptions,
  SessionStoreAdapter,
  SessionStoreData,
  SessionRawData,
  SessionMeta,
  ShutdownOptions
} from './types/types.js'
