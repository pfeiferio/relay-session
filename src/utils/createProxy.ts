export type ProxyWithTracking<T extends Record<string, unknown>> = {
  proxy: T
  data: Record<string, unknown>
  getDirtyPaths(): Set<string>
  clearDirty(): void
}

type ProxyData<T> = T & Record<string, unknown>

export const createProxy = <T>(data: ProxyData<T>): ProxyWithTracking<ProxyData<T>> => {
  const dirtyPaths = new Set<string>()
  const proxyCache = new WeakMap()

  const addDirtyPath = (path: string) => {
    const parts = path.split('.')
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('.')
      if (dirtyPaths.has(parent)) return
    }

    for (const existing of dirtyPaths) {
      if (existing.startsWith(`${path}.`)) {
        dirtyPaths.delete(existing)
      }
    }

    dirtyPaths.add(path)
  }

  const wrap = (target: Record<string, unknown>, prefix: string): Record<string, unknown> => {
    return new Proxy(target, {
      set(t, prop, value) {
        if (typeof prop === 'string' && !(Array.isArray(t) && prop === 'length')) {
          const path = prefix ? `${prefix}.${prop}` : prop
          if (Array.isArray(t)) {
            addDirtyPath(prefix) // gesamtes Array dirty, nicht foo.1
          } else {
            addDirtyPath(path)
          }
        }
        return Reflect.set(t, prop, value)
      },
      get(t, prop, receiver) {
        const value = Reflect.get(t, prop, receiver)

        if (Array.isArray(t) && typeof prop === 'string' && typeof value === 'function') {
          const arrayMutations = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'])
          if (arrayMutations.has(prop)) {
            return function (...args: unknown[]) {
              addDirtyPath(prefix)
              return (value as Function).apply(t, args)
            }
          }
        }

        if (typeof prop === 'string' && value !== null && typeof value === 'object') {
          const path = prefix ? `${prefix}.${prop}` : prop
          if (!proxyCache.has(value)) {
            proxyCache.set(value, wrap(value as Record<string, unknown>, path))
          }
          return proxyCache.get(value)
        }

        return value
      },
      deleteProperty(t, prop) {
        if (typeof prop === 'string') {
          const path = prefix ? `${prefix}.${prop}` : prop
          addDirtyPath(path)
        }
        return Reflect.deleteProperty(t, prop)
      },
    })
  }

  return {
    data,
    proxy: wrap(data, '') as ProxyData<T>,
    getDirtyPaths: () => dirtyPaths,
    clearDirty: () => dirtyPaths.clear(),
  }
}
