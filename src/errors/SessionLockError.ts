import {SESSION_LOCK_ERROR_REF_SYMBOL} from "./symbols.js";

export class SessionLockError extends Error {
  [SESSION_LOCK_ERROR_REF_SYMBOL]: true = true;
}
