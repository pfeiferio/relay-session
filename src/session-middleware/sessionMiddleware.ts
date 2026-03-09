import type {RequestHandler} from 'express'
import {createSessionRawData, generateId, updatePreviousSession} from "../session/utils.js";
import {getSessionIdFromCookie} from "../utils/getSessionIdFromCookie.js";
import type {SessionContext, SessionMiddlewareOptions, SessionRawData, SessionStoreData} from "../types/types.js";
import {validateOptions} from "../validations/validateOptions.js";
import {isSessionChainError} from "../errors/utils.js";
import {SessionChainBrokenError, SessionDepthError} from "../errors/index.js";
import {getDefaultOptions} from "./defaults.js";
import {createSession} from "../session/createSession.js";
import type {Task} from 'request-drain'
import {injectTools} from "../utils/injectTools.js";

export function sessionMiddleware<T extends Record<string, unknown>>(options: SessionMiddlewareOptions): RequestHandler {

  const validatedOptions = validateOptions(options, getDefaultOptions())
  const shutdownHandle = validatedOptions.shutdown.registry?.register()

  shutdownHandle?.onAbort(async () => {
    await shutdownHandle.waitUntilIdle(validatedOptions.shutdown.waitTimeout)
  })

  const loadSessionData = async (ctx: SessionContext, sessionId: string): Promise<SessionStoreData | null> => {

    if (ctx.depth > 10) {
      ctx.debug?.(`chain depth exceeded | depth=${ctx.depth} | updating previous=${ctx.previous!.id} -> ${sessionId}`)
      await updatePreviousSession(ctx.options, {
        id: ctx.previous!.id,
        redirectTo: sessionId
      })
      throw new SessionDepthError()
    }

    ctx.depth++

    const data = await ctx.options.store.get(sessionId)

    if (!data && ctx.isRedirected) {
      ctx.debug?.(`chain broken | sessionId=${sessionId} depth=${ctx.depth}`)
      throw new SessionChainBrokenError()
    }

    if (ctx.previous && data && !data?.meta.redirectTo) {
      ctx.debug?.(`chain shortcut | updating previous=${ctx.previous.id} -> ${sessionId}`)
      await updatePreviousSession(ctx.options, {
        id: ctx.previous!.id,
        redirectTo: sessionId
      })
    }

    if (data?.meta.redirectTo) {
      ctx.isRedirected = true
      ctx.previous ??= {
        id: sessionId,
        redirectTo: data.meta.redirectTo
      }
      ctx.debug?.(`chain redirect | depth=${ctx.depth} from=${sessionId} to=${data.meta.redirectTo}`)
      return await loadSessionData(ctx, data.meta.redirectTo)
    }

    return data
  }

  return async (req, res, next) => {

    shutdownHandle?.request(req)

    const ctx: Record<string, any> = {
      options: validatedOptions,
      depth: 0,
      req,
      res,
    }

    injectTools(ctx)
    const onCloseTasks: Task[] = []

    req.on('close', () => {
      if (req.session?.isLockOwner) req.session.unlock().catch((err) => validatedOptions.onUnlockError(err, req))
      if (!res.writableEnded) onCloseTasks.forEach(task => task.done())
    })

    if (ctx.options.debug) {
      const debugFn = ctx.options.debug
      ctx.debug = (msg: string) => debugFn(msg, req)
    }

    try {
      const sessionId = getSessionIdFromCookie(ctx) ?? generateId()
      const data = await loadSessionData(ctx, sessionId) ?? createSessionRawData<T>(ctx, sessionId)
      req.session = createSession(ctx, data as SessionRawData<T>)
      ctx.tools.setSessionCookieIfNeeded()

      ctx.debug?.(`session loaded | id=${req.session.id} isNew=${req.session.isNew} isRedirected=${req.session.isRedirected}`)

      if (ctx.options.autoSave) {
        const task = shutdownHandle?.startTask()
        if (task) onCloseTasks.push(task)
        res.on('finish', async () => {
          try {
            ctx.debug?.(`autosave | id=${req.session.id}`)
            await req.session.save()
            ctx.debug?.(`autosave success | id=${req.session.id}`)
          } catch (err) {
            ctx.debug?.(`autosave error | id=${req.session.id} err=${String(err)}`)
            ctx.options.onAutoSaveError(err, req)
          } finally {
            task?.done()
          }
        })
      }

    } catch (e) {
      if (isSessionChainError(e)) {
        ctx.debug?.(`chain error | ${e.constructor.name}`)
        ctx.options.onBrokenChain(req, res, next)
        return
      }

      return next(e)
    }

    next()
  }
}
