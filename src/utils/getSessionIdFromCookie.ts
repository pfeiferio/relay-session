import type {SessionContext} from "../types/types.js";
import {verifySessionId} from "./signCookie.js";

export const getSessionIdFromCookie = (
  ctx: SessionContext,
): string | null => {
  const cookieData = ctx.options.cookie.cookieReader(ctx.req, ctx.options.cookie.name) ?? {}
  const signedSessionId = cookieData[ctx.options.cookie.name]
  if (!signedSessionId) return null
  return verifySessionId(ctx, signedSessionId)
}
