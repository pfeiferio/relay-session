import {throwError} from "../errors/SessionConfigError.js";

export const isPositiveInteger = (value: unknown): boolean => {
  if (typeof value !== 'number') return false
  if (value <= 0) return false
  return Number.isInteger(value)
}

export const checkPositiveInteger = (value: unknown, field: string) => {
  if (isPositiveInteger(value)) return
  throwError(`"${field}" must be a positive integer`)
}

export const checkNonEmptyString = (value: unknown, field: string) => {
  if (!value || typeof value !== 'string') {
    throwError(`"${field}" must be a non-empty string`)
  }
}
export const isBoolean = (value: unknown): boolean => {
  return typeof value === 'boolean'
}

export const checkBoolean = (value: unknown, field: string) => {
  if (isBoolean(value)) return
  throwError(`"${field}" must be a boolean`)
}

export const isFunction = (value: unknown): boolean => {
  return typeof value === 'function'
}

export const checkFunction = (value: unknown, field: string) => {
  if (isFunction(value)) return
  throwError(`"${field}" must be a function`)
}
