import type {SessionContext} from '../types/types.js'
import {signSessionId} from "./signCookie.js";
import {setCookie} from "../cookies/cookies.js";

export const setSessionCookie = (
  ctx: SessionContext,
  value: string
): void => {
  ctx.debug?.('update session cookie')
  return setCookie(ctx.res, ctx.options.cookie, signSessionId(ctx, value))
}
