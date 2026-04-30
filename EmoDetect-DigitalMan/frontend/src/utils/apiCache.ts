/**
 * 内存请求缓存，用于 GET 请求去重与 TTL 缓存
 */

const CACHE = new Map<string, { data: unknown; timestamp: number }>()
const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 分钟

export interface ApiCacheOptions {
  /** 缓存时长（毫秒），默认 5 分钟 */
  ttl?: number
  /** 是否跳过缓存（强制请求） */
  skipCache?: boolean
}

function buildKey(method: string, url: string, params?: unknown): string {
  const paramsStr = params != null ? JSON.stringify(params) : ''
  return `${method}:${url}:${paramsStr}`
}

function isExpired(entry: { timestamp: number }, ttl: number): boolean {
  return Date.now() - entry.timestamp > ttl
}

export function getCached<T>(method: string, url: string, params?: unknown): T | null {
  const key = buildKey(method, url, params)
  const entry = CACHE.get(key)
  if (!entry) return null
  if (isExpired(entry, DEFAULT_TTL_MS)) {
    CACHE.delete(key)
    return null
  }
  return entry.data as T
}

export function setCache(
  method: string,
  url: string,
  data: unknown,
  params?: unknown,
  ttl = DEFAULT_TTL_MS
): void {
  const key = buildKey(method, url, params)
  CACHE.set(key, { data, timestamp: Date.now() })
  // 简单限制缓存数量，超过 200 条删除最旧的一半
  if (CACHE.size > 200) {
    const entries = Array.from(CACHE.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    )
    entries.slice(0, Math.floor(entries.length / 2)).forEach(([k]) => CACHE.delete(k))
  }
}

export function invalidateCache(pattern?: string | RegExp): void {
  if (!pattern) {
    CACHE.clear()
    return
  }
  const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern
  for (const key of CACHE.keys()) {
    if (re.test(key)) CACHE.delete(key)
  }
}

export function createCachedGetter<T>(
  getKey: (params?: unknown) => string,
  fetcher: (params?: unknown) => Promise<T>,
  options: ApiCacheOptions = {}
): (params?: unknown) => Promise<T> {
  const { ttl = DEFAULT_TTL_MS, skipCache = false } = options
  return async (params?: unknown) => {
    const key = getKey(params)
    if (!skipCache) {
      const cached = getCached<T>('GET', key, params)
      if (cached != null) return cached
    }
    const data = await fetcher(params)
    setCache('GET', key, data, params, ttl)
    return data
  }
}
