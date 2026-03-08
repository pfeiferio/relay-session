import type {SessionContext, SessionRawData} from "../types/types.js";
import {setSessionCookie} from "../utils/setSessionCookie.js";
import {Session} from "./Session.js";
import {createSessionRawData, generateId} from "./utils.js";

export const createSession = <T>(
  ctx: SessionContext,
  data: SessionRawData<T>,
): Session<T> => {
  const session = new Session<T>(ctx, data, () => {
    ctx.debug?.(`destroy | id=${session.id} -> creating new session`)
    ctx.req.session = createSession(ctx, createSessionRawData(ctx, generateId()))
    ctx.tools.setSessionCookieIfNeeded()
    ctx.req.session.maxAge(ctx.options.cookie.ttl)
  }, (sessionId) => {
    ctx.debug?.(`rotateId cookie update | new id=${sessionId}`)
    setSessionCookie(ctx, sessionId)
  })
  return session
}
