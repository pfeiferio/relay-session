import type {Response} from 'express'
import type {ValidatedSessionCookieOptions} from '../types/types.js'

export const delCookie = (
  res: Response,
  options: ValidatedSessionCookieOptions
): void => setCookie(res, {...options, ttl: 0}, '')

export const setCookie = (
  res: Response,
  options: ValidatedSessionCookieOptions,
  value: string,
): void => {
  const parts: string[] = [
    `${options.name}=${encodeURIComponent(value)}`,
    `Path=/`,
    `Max-Age=${Math.floor(options.ttl / 1000)}`
  ]

  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')

  parts.push(`SameSite=${options.sameSite.charAt(0).toUpperCase()}${options.sameSite.slice(1)}`)
  res.appendHeader('Set-Cookie', parts.join('; '))
}
