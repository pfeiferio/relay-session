import {setSessionCookie} from "./setSessionCookie.js";
import type {SessionContext} from "../types/types.js";

export function injectTools(value: unknown): asserts value is SessionContext {
  const ctx = value as SessionContext
  ctx.tools = {
    setSessionCookieIfNeeded() {
      let set = ctx.isNew === true || ctx.options.rolling === true

      if (!set && ctx.options.rolling === false) return

      if (
        !set
        && ctx.options.rolling !== true
        && ctx.options.rolling !== false
      ) {
        const remaining = ctx.req.session.expiresAt - Date.now()
        const threshold = ctx.options.cookie.ttl * (1 - (ctx.options.rolling as number))
        set = remaining <= threshold
      }

      if (!set) return;
      ctx.req.session.maxAge(ctx.options.cookie.ttl)
      setSessionCookie(ctx, ctx.req.session.id)
    }
  }
}
