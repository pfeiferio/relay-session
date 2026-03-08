import crypto from 'node:crypto'
import type {SessionContext} from "../types/types.js";
import {sha256, sign} from "./hash.js";

export const signSessionId = (
  ctx: SessionContext,
  sessionId: string
): string => {
  return `${sessionId}.${createSignature(ctx, sessionId, ctx.options.cookie.secret)}`
}

export const createSignature = (
  ctx: SessionContext,
  sessionId: string,
  secret: string
) => {
  let signWith = ctx.options.signWith?.(ctx.req)
  if (Array.isArray(signWith)) {
    signWith = signWith.join('|')
  }

  if (ctx.options.signWith) signWith = sha256(signWith!)
  return sign(sessionId + (signWith ?? ''), secret)
}

export const verifySessionId = (() => {
  const verify = (
    ctx: SessionContext,
    cookie: string,
    secret: string
  ): string | null => {
    const lastDot = cookie.lastIndexOf('.')
    if (lastDot === -1) return null

    const sessionId = cookie.slice(0, lastDot)
    const signature = cookie.slice(lastDot + 1)

    if (!sessionId || !signature) {
      ctx.debug?.(`verify session failed | malformed cookie`)
      return null
    }

    const expected = createSignature(ctx, sessionId, secret)
    const isValid = signature.length === expected.length && crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    )

    ctx.debug?.(`verify session | sessionId=${sessionId} valid=${isValid}`)

    return isValid ? sessionId : null
  }

  return (
    ctx: SessionContext,
    cookie: string
  ): string | null => {

    const secrets = [
      ctx.options.cookie.secret,
      ...ctx.options.cookie.oldSecrets
    ]

    for (const secret of secrets) {
      if (!secret) {
        continue
      }
      const sessionId = verify(ctx, cookie, secret)
      if (sessionId) {
        return sessionId
      }
    }
    return null
  }
})();
