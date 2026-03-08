import type {SessionChainError} from "./SessionChainError.js";
import type {SessionDepthError} from "./SessionDepthError.js";
import type {SessionChainBrokenError} from "./SessionChainBrokenError.js";
import {SessionConfigError} from "./SessionConfigError.js";
import {
  SESSION_CHAIN_BROKEN_ERROR_REF_SYMBOL,
  SESSION_CHAIN_DEPTH_ERROR_REF_SYMBOL,
  SESSION_CHAIN_ERROR_REF_SYMBOL,
  SESSION_CONFIG_ERROR_REF_SYMBOL,
  SESSION_LOCK_ERROR_REF_SYMBOL
} from "./symbols.js";
import type {SessionLockError} from "./SessionLockError.js";

export function isSessionChainError(value: unknown): value is SessionChainError {
  return typeof value === 'object' && value !== null && (value as any)[SESSION_CHAIN_ERROR_REF_SYMBOL] === true
}

export function isSessionDepthError(value: unknown): value is SessionDepthError {
  return typeof value === 'object' && value !== null && (value as any)[SESSION_CHAIN_DEPTH_ERROR_REF_SYMBOL] === true
}

export function isSessionChainBrokenError(value: unknown): value is SessionChainBrokenError {
  return typeof value === 'object' && value !== null && (value as any)[SESSION_CHAIN_BROKEN_ERROR_REF_SYMBOL] === true
}

export function isSessionConfigError(value: unknown): value is SessionConfigError {
  return typeof value === 'object' && value !== null && (value as any)[SESSION_CONFIG_ERROR_REF_SYMBOL] === true
}

export function isSessionLockError(value: unknown): value is SessionLockError {
  return typeof value === 'object' && value !== null && (value as any)[SESSION_LOCK_ERROR_REF_SYMBOL] === true
}
