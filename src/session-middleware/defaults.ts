import type {SessionMiddlewareOptions} from "../types/types.js";
import type {Request, Response} from "express";
import {createInMemoryStorage} from "../utils/createInMemoryStorage.js";

export const getDefaultOptions = (): SessionMiddlewareOptions => ({
  debug: false,
  store: createInMemoryStorage(),
  autoSave: false,
  cookie: {
    secure: true,
    sameSite: 'strict',
    httpOnly: true,
    oldSecrets: [],
    cookieReader: (req: Request, name: string) => {
      const header = req.headers.cookie
      if (!header) return {}
      const match = header
        .split(';')
        .map(p => p.trim())
        .find(p => p.startsWith(`${name}=`))

      const signedSessionId = match ? decodeURIComponent(match.slice(name.length + 1)) : null
      return {
        [name]: signedSessionId
      }
    }
  },
  shutdown: {
    waitTimeout: 30_000
  },
  lock: {
    ttl: 5_000,
    retries: 10,
    backoff: 50
  },
  onUnlockError: (err: unknown) => console.error('[session] unlock error', err),
  onAutoSaveError: (err: unknown) => console.error('[session] save error', err),
  onBrokenChain: (_req: Request, res: Response) => res.status(410).json({error: 'session expired'}),
  rotation: {
    gracePeriod: undefined, // Default value = cookie.ttl
  }
} as unknown as SessionMiddlewareOptions);
