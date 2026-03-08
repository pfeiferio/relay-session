import {SESSION_CONFIG_ERROR_REF_SYMBOL} from "./symbols.js";

/**
 * Error type thrown for invalid Session middleware configuration.
 *
 * This error indicates a misconfiguration detected during
 * middleware initialization and should be treated as a
 * developer error (not a runtime request error).
 */
export class SessionConfigError extends Error {

  [SESSION_CONFIG_ERROR_REF_SYMBOL]: true = true;

  constructor(message: string) {
    super(message)
    this.name = 'SessionConfigError'
  }
}

export const throwError = (msg: string) => {
  throw new SessionConfigError(`sessionMiddleware: ${msg}`)
}
