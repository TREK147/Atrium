import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { User, Conversation, Message } from '@/types'
import { getCached, setCache, invalidateCache } from './apiCache'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'
const DEFAULT_TIMEOUT = 30000

/**
 * 将后端返回的路径（如 /api/uploads/...）转为浏览器可请求的 URL。
 * 开发环境始终用相对路径走 Vite /api 代理，避免 VITE_API_URL 写成 127.0.0.1 时局域网访问失败。
 */
export function resolveApiAssetUrl(path: string): string {
  const p = (path || '').trim()
  if (!p) return p
  if (
    p.startsWith('http://') ||
    p.startsWith('https://') ||
    p.startsWith('blob:') ||
    p.startsWith('data:')
  ) {
    return p
  }
  if (import.meta.env.DEV) {
    return p.startsWith('/') ? p : `/${p}`
  }
  const base = import.meta.env.VITE_API_URL ?? '/api'
  if (base.startsWith('http://') || base.startsWith('https://')) {
    try {
      const apiOrigin = new URL(base).origin
      if (typeof window !== 'undefined' && window.location.origin !== apiOrigin) {
        const absolutePath = p.startsWith('/') ? p : `/${p}`
        return `${apiOrigin}${absolutePath}`
      }
    } catch {
      return p.startsWith('/') ? p : `/${p}`
    }
  }
  return p.startsWith('/') ? p : `/${p}`
}
/** 人脸预热 POST/轮询：后端应秒回，但慢网络/Vite 代理下偶发超过 60s，避免误判超时 */
const FACE_WARMUP_HTTP_TIMEOUT_MS = 300_000
const MAX_RETRIES = 3
const RETRY_DELAY_BASE = 1000

/** 单文件上传最大大小（10MB），上传前校验，超过则提示并终止 */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
export const MAX_FILE_SIZE_LABEL = '10MB'

/** 认证 token 存储 key */
const TOKEN_KEY = 'auth_token'

export const getStoredToken = (): string | null => localStorage.getItem(TOKEN_KEY)
export const setStoredToken = (token: string | null) => {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

const client = axios.create({
  baseURL: BASE_URL,
  timeout: DEFAULT_TIMEOUT,
  headers: { 'Content-Type': 'application/json' },
})

/** 是否为可重试的错误 */
function isRetryableError(err: AxiosError): boolean {
  // 请求超时不应重试，否则用户会长时间无反馈（例如人脸注册首次加载模型）
  const msg = (err.message || '').toLowerCase()
  if (err.code === 'ECONNABORTED' || msg.includes('timeout')) return false
  if (!err.response) return true // 网络错误
  const status = err.response.status
  if (status === 401 || status === 403) return false
  return status >= 500 || status === 408 || status === 429
}

/** 延迟 */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 请求拦截：注入 token */
client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getStoredToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/** 响应拦截：错误处理与重试 */
client.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const config = err.config as InternalAxiosRequestConfig & { _retryCount?: number }
    config._retryCount = config._retryCount ?? 0

    if (config._retryCount < MAX_RETRIES && isRetryableError(err)) {
      config._retryCount += 1
      const wait = RETRY_DELAY_BASE * Math.pow(2, config._retryCount - 1)
      await delay(wait)
      return client.request(config)
    }

    if (err.response?.status === 401) setStoredToken(null)
    return Promise.reject(normalizeApiError(err))
  }
)

/** 统一错误格式 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public payload?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function normalizeApiError(err: AxiosError): ApiError {
  const status = err.response?.status
  const data = err.response?.data as { message?: string; error?: string; code?: string } | undefined
  const noResponse = !err.response
  const networkHint =
    '无法连接后端：请在 EmoDetect-DigitalMan/backend 目录执行 python app.py（或 python3 app.py），保持终端不关；Vite 会把 /api 代理到本机 :5000。若终端出现 Killed，多为内存不足（OOM），请增加 swap 或换更大内存机器。'
  const msgLower = (err.message || '').toLowerCase()
  const isConnRefused =
    err.code === 'ECONNREFUSED' || msgLower.includes('econnrefused') || msgLower.includes('connect econnrefused')
  let message =
    data?.message ?? data?.error ?? err.message ?? `请求失败${status ? ` (${status})` : ''}`
  const isTimeout = err.code === 'ECONNABORTED' || msgLower.includes('timeout')
  const reqPath = typeof err.config?.url === 'string' ? err.config.url : ''
  const isFaceWarmupPath = reqPath.includes('face/warmup')
  if (isTimeout) {
    message = isFaceWarmupPath
      ? '人脸预热接口请求超时：请确认 Flask 在 :5000 运行且未被阻塞；若机器或网络较慢，请稍后点击「重试加载模型」。'
      : '请求超时：后端可能仍在处理（如人脸模型加载），请稍后重试或查看后端终端日志'
  } else if (noResponse && (err.code === 'ERR_NETWORK' || err.message === 'Network Error' || isConnRefused)) {
    message = networkHint
  }
  return new ApiError(message, status, data?.code, data)
}

// ---------- 类型 ----------

export interface LoginRequest {
  account: string
  password: string
}

export interface RegisterRequest {
  email?: string
  student_id?: string
  password: string
  username: string
}

export interface AuthResponse {
  user: User
  token: string
}

export interface ConversationCreateRequest {
  title?: string
}

export interface MessageSendRequest {
  content: string
  type?: 'text' | 'image' | 'file' | 'voice' | 'video'
  fileUrl?: string
  fileName?: string
}

// ---------- 1. 用户认证 API ----------

export async function login(data: LoginRequest): Promise<AuthResponse> {
  const res = await client.post<AuthResponse>('/auth/login', data)
  if (res.data.token) setStoredToken(res.data.token)
  return res.data
}

export async function register(data: RegisterRequest): Promise<AuthResponse> {
  const res = await client.post<AuthResponse>('/auth/register', data)
  if (res.data.token) setStoredToken(res.data.token)
  return res.data
}

export async function logout(): Promise<void> {
  try {
    await client.post('/auth/logout')
  } finally {
    setStoredToken(null)
  }
}

/** 获取当前用户信息 */
export async function getCurrentUser(): Promise<User> {
  const res = await client.get<User>('/auth/me')
  return res.data
}

export async function setPreferredName(preferredName: string): Promise<User> {
  const res = await client.post<User>('/auth/preferred-name', { preferred_name: preferredName })
  return res.data
}

export interface UserFeedbackRequest {
  content: string
  screenshotUrl?: string
  allowContact?: boolean
}

export async function submitUserFeedback(data: UserFeedbackRequest): Promise<{ ok: boolean; id?: number }> {
  const payload = {
    content: (data.content || '').trim(),
    screenshot_url: (data.screenshotUrl || '').trim() || undefined,
    allow_contact: data.allowContact ? 1 : 0,
  }
  const res = await client.post<{ ok: boolean; id?: number }>('/feedback', payload)
  return res.data
}

// ---------- 2. 对话管理 API ----------

const CACHE_TTL = 5 * 60 * 1000 // 5 分钟

/** 切换账号前调用，清空对话/消息缓存，避免新用户读到旧用户数据 */
export function invalidateConversationsCache(): void {
  invalidateCache(/^GET:\/conversations/)
}

export async function getConversations(): Promise<Conversation[]> {
  const cached = getCached<Conversation[]>('GET', '/conversations')
  if (cached != null) return cached
  const res = await client.get<Conversation[]>('/conversations')
  const list = (res.data ?? []).map(normalizeConversation)
  setCache('GET', '/conversations', list, undefined, CACHE_TTL)
  return list
}

export async function createConversation(
  data?: ConversationCreateRequest
): Promise<Conversation> {
  const res = await client.post<Conversation>('/conversations', data ?? {})
  invalidateCache(/^GET:\/conversations:/)
  return normalizeConversation(res.data)
}

export async function getConversation(id: string): Promise<Conversation> {
  const cached = getCached<Conversation>('GET', `/conversations/${id}`)
  if (cached != null) return cached
  const res = await client.get<Conversation>(`/conversations/${id}`)
  const normalized = normalizeConversation(res.data)
  setCache('GET', `/conversations/${id}`, normalized, undefined, CACHE_TTL)
  return normalized
}

export async function patchConversation(
  id: string,
  patch: { title?: string; pinned?: boolean }
): Promise<Conversation> {
  const res = await client.patch<Conversation>(`/conversations/${id}`, patch)
  invalidateCache(/^GET:\/conversations:/)
  invalidateCache(new RegExp(`/conversations/${id}`))
  return normalizeConversation(res.data)
}

export async function deleteConversation(id: string): Promise<void> {
  await client.delete(`/conversations/${id}`)
  invalidateCache(/^GET:\/conversations:/)
  invalidateCache(new RegExp(`/conversations/${id}`))
}

/** 使某会话的消息列表缓存失效（发送新消息后调用，以便切换回时拉取最新） */
export function invalidateConversationMessages(conversationId: string): void {
  invalidateCache(new RegExp(`/conversations/${conversationId}/messages`))
}

function normalizeConversation(c: Conversation): Conversation {
  return {
    ...c,
    updatedAt: c.updatedAt ? new Date(c.updatedAt) : new Date(),
  }
}

// ---------- 3. 消息 API ----------

export async function getMessages(conversationId: string): Promise<Message[]> {
  const url = `/conversations/${conversationId}/messages`
  const cached = getCached<Message[]>('GET', url)
  if (cached != null) return cached
  const res = await client.get<Message[]>(url)
  const list = (res.data ?? []).map(normalizeMessage)
  setCache('GET', url, list, undefined, CACHE_TTL)
  return list
}

/** 发送文本消息 */
export async function sendTextMessage(
  conversationId: string,
  content: string
): Promise<Message> {
  const res = await client.post<Message>(
    `/conversations/${conversationId}/messages`,
    { content, type: 'text' }
  )
  return normalizeMessage(res.data)
}

/** 发送文件/语音：multipart/form-data */
export async function sendFileMessage(
  conversationId: string,
  file: File,
  type: 'image' | 'file' | 'voice',
  content = ''
): Promise<Message> {
  const form = new FormData()
  form.append('file', file)
  form.append('content', content)
  form.append('type', type)
  const res = await client.post<Message>(
    `/conversations/${conversationId}/messages`,
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    }
  )
  return normalizeMessage(res.data)
}

/** 统一发送入口：根据内容类型选择文本或文件 */
export async function sendMessage(
  conversationId: string,
  payload: MessageSendRequest | { type: 'file'; file: File; content?: string }
): Promise<Message> {
  if ('file' in payload && payload.file) {
    const t = payload.type === 'file' ? 'file' : 'image'
    return sendFileMessage(conversationId, payload.file, t, payload.content)
  }
  return sendTextMessage(conversationId, payload.content ?? '')
}

function normalizeMessage(m: Message): Message {
  return {
    ...m,
    timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
  }
}

// ---------- 4. 流式响应 ----------

export interface StreamChunk {
  type: 'text' | 'done' | 'error'
  content?: string
  messageId?: string
}

/**
 * 发送消息并消费 SSE 流式响应。
 * 通过 onChunk 回调逐块接收内容；流结束后 resolve 最终 message（若后端返回）。
 */
export async function sendMessageStream(
  conversationId: string,
  content: string,
  onChunk: (chunk: StreamChunk) => void
): Promise<Message | null> {
  const token = getStoredToken()
  const url = `${BASE_URL}/conversations/${conversationId}/messages/stream`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ content, type: 'text' }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new ApiError(
      (err as { message?: string }).message ?? `Stream failed: ${res.status}`,
      res.status
    )
  }

  const reader = res.body?.getReader()
  if (!reader) {
    onChunk({ type: 'done' })
    return null
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let lastMessage: Message | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const raw = line.slice(6)
        if (raw === '[DONE]') {
          onChunk({ type: 'done' })
          continue
        }
        try {
          const data = JSON.parse(raw) as {
            type?: string
            content?: string
            messageId?: string
            message?: Message
          }
          if (data.message) lastMessage = normalizeMessage(data.message)
          if (data.type === 'text' && data.content)
            onChunk({ type: 'text', content: data.content })
          if (data.type === 'done' && data.messageId)
            onChunk({ type: 'done', messageId: data.messageId })
          if (data.type === 'error')
            onChunk({ type: 'error', content: (data as { error?: string }).error })
        } catch {
          // 非 JSON 行忽略
        }
      }
    }
  }

  if (buffer.trim() && buffer.startsWith('data: ')) {
    try {
      const data = JSON.parse(buffer.slice(6))
      if (data.content) onChunk({ type: 'text', content: data.content })
    } catch {
      // ignore
    }
  }
  onChunk({ type: 'done' })
  return lastMessage
}

/**
 * 带重试的流式发送（仅对网络/5xx 重试，最多 MAX_RETRIES 次）
 */
export async function sendMessageStreamWithRetry(
  conversationId: string,
  content: string,
  onChunk: (chunk: StreamChunk) => void
): Promise<Message | null> {
  let lastError: unknown
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await sendMessageStream(conversationId, content, onChunk)
    } catch (err) {
      lastError = err
      const status = err instanceof ApiError ? err.status : undefined
      if (status != null && (status === 401 || status === 403)) break
      if (i < MAX_RETRIES - 1) await delay(RETRY_DELAY_BASE * Math.pow(2, i))
    }
  }
  throw lastError
}

// ---------- 5. 实时语音（DashScope qwen3-omni-flash-realtime：语音入 -> 文本+语音出） ----------

const REALTIME_PCM_SAMPLE_RATE = 16000

/**
 * 将录音 Blob（如 webm）解码为 16k 16bit 单声道 PCM，返回 base64。
 * 供「点击数字人」后发送语音时调用 Realtime 接口使用。
 */
export async function decodeAudioBlobToPcm16Base64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer()
  const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
  const srcRate = audioBuffer.sampleRate
  const channel = audioBuffer.getChannelData(0)
  const srcLength = channel.length
  const dstLength = Math.floor((srcLength * REALTIME_PCM_SAMPLE_RATE) / srcRate)
  const pcm16 = new Int16Array(dstLength)
  for (let i = 0; i < dstLength; i++) {
    const srcIndex = (i * srcRate) / REALTIME_PCM_SAMPLE_RATE
    const idx = Math.floor(srcIndex)
    const frac = srcIndex - idx
    const s = idx < srcLength - 1 ? channel[idx]! + frac * (channel[idx + 1]! - channel[idx]!) : channel[idx]!
    const v = Math.max(-1, Math.min(1, s))
    pcm16[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  const b64 = btoa(
    String.fromCharCode(...new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength))
  )
  await audioContext.close()
  return b64
}

/** 将录音 Blob 转为 wav 文件（16bit PCM 单声道），便于 Omni input_audio 兼容解析 */
export async function convertAudioBlobToWavFile(
  blob: Blob,
  fileName = `voice-${Date.now()}.wav`
): Promise<File> {
  const arrayBuffer = await blob.arrayBuffer()
  const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
    const sampleRate = audioBuffer.sampleRate
    const src = audioBuffer.getChannelData(0)
    const pcm = new Int16Array(src.length)
    for (let i = 0; i < src.length; i++) {
      const s = Math.max(-1, Math.min(1, src[i]!))
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    const wavBytes = 44 + pcm.byteLength
    const out = new ArrayBuffer(wavBytes)
    const view = new DataView(out)
    let off = 0
    const writeAscii = (text: string) => {
      for (let i = 0; i < text.length; i++) view.setUint8(off++, text.charCodeAt(i))
    }
    // RIFF header
    writeAscii('RIFF')
    view.setUint32(off, wavBytes - 8, true); off += 4
    writeAscii('WAVE')
    // fmt chunk
    writeAscii('fmt ')
    view.setUint32(off, 16, true); off += 4 // PCM fmt chunk size
    view.setUint16(off, 1, true); off += 2 // audio format = PCM
    view.setUint16(off, 1, true); off += 2 // channels = mono
    view.setUint32(off, sampleRate, true); off += 4
    view.setUint32(off, sampleRate * 2, true); off += 4 // byte rate
    view.setUint16(off, 2, true); off += 2 // block align
    view.setUint16(off, 16, true); off += 2 // bits per sample
    // data chunk
    writeAscii('data')
    view.setUint32(off, pcm.byteLength, true); off += 4
    new Int16Array(out, off, pcm.length).set(pcm)
    const wavBlob = new Blob([out], { type: 'audio/wav' })
    return new File([wavBlob], fileName, { type: 'audio/wav' })
  } finally {
    await audioContext.close()
  }
}

/**
 * 实时语音对话：发送 PCM base64，通过 SSE 接收文本片段与音频片段（与聊天框同步）。
 * 仅当「点击数字人」开启语音时，发送语音消息走此接口。
 */
export async function chatRealtimeStream(
  conversationId: string,
  pcmBase64: string,
  onTextDelta: (delta: string) => void,
  onAudioDelta: (base64: string) => void,
  onAssistantAudio?: (info: { audioUrl: string; fileName: string }) => void
): Promise<void> {
  const token = getStoredToken()
  const res = await fetch(`${BASE_URL}/chat/realtime`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ conversationId, pcmBase64 }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new ApiError(
      (err as { error?: string }).error ?? `实时语音请求失败: ${res.status}`,
      res.status
    )
  }
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '[DONE]') return
      try {
        const data = JSON.parse(raw) as {
          content?: string
          audio?: string
          error?: string
          audioUrl?: string
          fileName?: string
        }
        if (data.error) throw new ApiError(data.error, 500)
        if (data.content) onTextDelta(data.content)
        if (data.audio) onAudioDelta(data.audio)
        if (data.audioUrl)
          onAssistantAudio?.({
            audioUrl: data.audioUrl,
            fileName: data.fileName ?? 'reply.wav',
          })
      } catch (e) {
        if (e instanceof ApiError) throw e
      }
    }
  }
  if (buffer.startsWith('data: ')) {
    const raw = buffer.slice(6).trim()
    if (raw !== '[DONE]') {
      try {
        const data = JSON.parse(raw) as {
          content?: string
          audio?: string
          error?: string
          audioUrl?: string
          fileName?: string
        }
        if (data.error) throw new ApiError(data.error, 500)
        if (data.content) onTextDelta(data.content)
        if (data.audio) onAudioDelta(data.audio)
        if (data.audioUrl)
          onAssistantAudio?.({
            audioUrl: data.audioUrl,
            fileName: data.fileName ?? 'reply.wav',
          })
      } catch (e) {
        if (e instanceof ApiError) throw e
      }
    }
  }
}

export interface RealtimeSessionStartResponse {
  sessionId: string
}

export type RealtimeSessionEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'audio_delta'; audio: string }
  | { type: 'response_done' }
  | { type: 'error'; error: string }
  | { type: 'session_closed'; reason?: string }

/** 开启持续实时会话：后端建立到 qwen3-omni-flash-realtime 的 WS 会话。 */
export async function startRealtimeSession(conversationId?: string): Promise<RealtimeSessionStartResponse> {
  const token = getStoredToken()
  const body = conversationId ? { conversationId } : {}
  const res = await fetch(`${BASE_URL}/chat/realtime/session/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new ApiError(
      (err as { error?: string }).error ?? `开启实时会话失败: ${res.status}`,
      res.status
    )
  }
  return res.json()
}

/** 向持续实时会话追加音频分片（16k/pcm16/base64）。 */
export async function appendRealtimeSessionAudio(sessionId: string, audioBase64: string): Promise<void> {
  const token = getStoredToken()
  const res = await fetch(`${BASE_URL}/chat/realtime/session/${encodeURIComponent(sessionId)}/audio`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ audio: audioBase64 }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new ApiError(
      (err as { error?: string }).error ?? `发送实时音频失败: ${res.status}`,
      res.status
    )
  }
}

/** 订阅实时会话事件流（SSE）：持续接收文本/语音增量。 */
export async function subscribeRealtimeSessionEvents(
  sessionId: string,
  onEvent: (event: RealtimeSessionEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const token = getStoredToken()
  const res = await fetch(`${BASE_URL}/chat/realtime/session/${encodeURIComponent(sessionId)}/events`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new ApiError(
      (err as { error?: string }).error ?? `订阅实时事件失败: ${res.status}`,
      res.status
    )
  }
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (!raw) continue
      try {
        const event = JSON.parse(raw) as RealtimeSessionEvent
        onEvent(event)
      } catch {
        // ignore malformed SSE row
      }
    }
  }
}

/** 停止持续实时会话并释放后端连接资源。 */
export async function stopRealtimeSession(sessionId: string): Promise<void> {
  const token = getStoredToken()
  const res = await fetch(`${BASE_URL}/chat/realtime/session/${encodeURIComponent(sessionId)}/stop`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new ApiError(
      (err as { error?: string }).error ?? `关闭实时会话失败: ${res.status}`,
      res.status
    )
  }
}

// ---------- 6. AI 对话（对接 backend /api/chat，DashScope qwen3-omni-flash） ----------

export interface ChatHistoryItem {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatResponse {
  content: string
}

/** 上传文件，返回 url、fileName、category（image|video|file|voice） */
export interface UploadResult {
  url: string
  fileName: string
  mimeType: string
  category: 'image' | 'video' | 'file' | 'voice'
}

const UPLOAD_TIMEOUT_MS = 60000
/** 流式对话（含语音多模态）可能较慢，避免无限等待 */
const CHAT_STREAM_TIMEOUT_MS = 120_000

export async function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  const token = getStoredToken()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new ApiError(
        (err as { error?: string }).error ?? `上传失败: ${res.status}`,
        res.status
      )
    }
    return res.json()
  } catch (e) {
    clearTimeout(timeoutId)
    if (e instanceof ApiError) throw e
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ApiError('上传超时，请检查网络后重试')
    }
    throw new ApiError(e instanceof Error ? e.message : '上传失败，请重试')
  }
}

/** 发送一条用户消息，携带可选历史，获取 AI 回复 */
export async function chatWithAI(
  content: string,
  history?: ChatHistoryItem[]
): Promise<ChatResponse> {
  const res = await client.post<ChatResponse>('/chat', { content, messages: history ?? [] })
  return res.data
}

export interface ChatStreamOptions {
  imageUrl?: string
  videoUrl?: string
  /** 文档/文件 URL（如 /api/uploads/...），后端会解析文本后喂给模型 */
  fileUrl?: string
  /** 文档文件名，用于提示模型与日志落库展示 */
  fileName?: string
  attachmentHint?: string
  /** 用户语音上传后的地址（如 /api/uploads/...），服务端会读文件并以 input_audio 发给 qwen3-omni-flash */
  audioUrl?: string
  /** 与 audioUrl 对应的文件名，用于落库展示 */
  voiceFileName?: string
  /** 流式结束后 Omni 模型可能返回已保存的助手语音 URL（相对路径如 /api/uploads/...） */
  onAssistantAudio?: (info: { audioUrl: string; fileName: string }) => void
  /** 是否隐藏用户发送的消息（不在前端显示，且告知后端不落库用户消息） */
  hideUserMessage?: boolean
}

/** 流式对话：需登录，会话历史由服务端从数据库读取并持久化。通过 onChunk 逐块接收 AI 回复。支持图片（imageUrl）、视频（videoUrl）与语音（audioUrl）。 */
export async function chatWithAIStream(
  conversationId: string,
  content: string,
  onChunk: (chunk: string) => void,
  options?: ChatStreamOptions
): Promise<void> {
  const token = getStoredToken()
  const url = `${BASE_URL}/chat/stream`
  const body: Record<string, unknown> = {
    conversationId,
    content: content || undefined,
  }
  if (options?.imageUrl) body.imageUrl = options.imageUrl
  if (options?.videoUrl) body.videoUrl = options.videoUrl
  if (options?.fileUrl) body.fileUrl = options.fileUrl
  if (options?.fileName) body.fileName = options.fileName
  if (options?.attachmentHint) body.attachmentHint = options.attachmentHint
  if (options?.audioUrl) body.audioUrl = options.audioUrl
  if (options?.voiceFileName) body.voiceFileName = options.voiceFileName
  if (options?.hideUserMessage) body.hideUserMessage = options.hideUserMessage
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), CHAT_STREAM_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new ApiError(
        (err as { error?: string }).error ?? `请求失败: ${res.status}`,
        res.status
      )
    }
    const reader = res.body?.getReader()
    if (!reader) return
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') return
          try {
            const data = JSON.parse(raw) as {
              content?: string
              error?: string
              audioUrl?: string
              fileName?: string
            }
            if (data.error) throw new ApiError(data.error, 500)
            if (data.content) onChunk(data.content)
            if (data.audioUrl)
              options?.onAssistantAudio?.({
                audioUrl: data.audioUrl,
                fileName: data.fileName ?? 'reply.wav',
              })
          } catch (e) {
            if (e instanceof ApiError) throw e
          }
        }
      }
    }
    if (buffer.startsWith('data: ')) {
      const raw = buffer.slice(6).trim()
      if (raw !== '[DONE]') {
        try {
          const data = JSON.parse(raw) as {
            content?: string
            error?: string
            audioUrl?: string
            fileName?: string
          }
          if (data.error) throw new ApiError(data.error, 500)
          if (data.content) onChunk(data.content)
          if (data.audioUrl)
            options?.onAssistantAudio?.({
              audioUrl: data.audioUrl,
              fileName: data.fileName ?? 'reply.wav',
            })
        } catch (e) {
          if (e instanceof ApiError) throw e
        }
      }
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ApiError('对话请求超时，请稍后重试或检查后端与网络')
    }
    if (e instanceof ApiError) throw e
    throw new ApiError(e instanceof Error ? e.message : '请求失败')
  } finally {
    clearTimeout(timeoutId)
  }
}

// ---------- 情绪异常与主动疏导 ----------

export interface EmotionAnomaly {
  id: number
  user_id: number
  emotion_label: string
  reason: string
  from_monitoring: number
  created_at: string
}

export interface EmotionStatsPoint {
  date: string
  count: number
}

export async function getEmotionStats(days = 30): Promise<EmotionStatsPoint[]> {
  const res = await client.get<EmotionStatsPoint[]>('/emotion/stats', { params: { days } })
  return res.data ?? []
}

export async function getEmotionAnomalies(params?: { limit?: number; since_days?: number }): Promise<EmotionAnomaly[]> {
  const res = await client.get<EmotionAnomaly[]>('/emotion/anomalies', { params: params ?? {} })
  return res.data ?? []
}

export interface ProactiveTrigger {
  id: number
  trigger_type: string
  created_at: string
}

export interface ProactiveCarePayload {
  conversationId: string
  message: Message
}

export async function getProactivePending(): Promise<ProactiveTrigger | null> {
  const res = await client.get<ProactiveTrigger | null>('/proactive/pending')
  return res.data ?? null
}

export async function ackProactiveTrigger(triggerId: number): Promise<{ ok: boolean; careMessage?: ProactiveCarePayload | null }> {
  const res = await client.post<{ ok: boolean; careMessage?: ProactiveCarePayload | null }>('/proactive/ack', { triggerId })
  return res.data
}

// ---------- 本天情感日记（由对话摘要生成；接口路径仍为 /journal/weekly） ----------

export interface WeeklyJournal {
  id: number
  user_id: number
  week_start: string
  mood: string
  body: string
  created_at: string
  updated_at: string
}

export interface WeeklyJournalSummary {
  week_start: string
  week_end: string
  mood: string
  body: string
}

export async function listWeeklyJournals(limit = 24): Promise<WeeklyJournal[]> {
  const res = await client.get<WeeklyJournal[]>('/journal/weekly', { params: { limit } })
  return res.data ?? []
}

export async function generateWeeklyJournal(weekStart?: string): Promise<WeeklyJournal> {
  const res = await client.post<WeeklyJournal>(
    '/journal/weekly/generate',
    { week_start: weekStart },
    { timeout: 150_000 },
  )
  return res.data
}

export async function generateWeeklySummary(weekStart?: string): Promise<WeeklyJournalSummary> {
  const res = await client.post<WeeklyJournalSummary>(
    '/journal/weekly/summary',
    { week_start: weekStart },
    { timeout: 150_000 },
  )
  return res.data
}

export interface ScheduleSuggestion {
  title: string
  scheduled_at: string
  note: string
}

export interface ChatInsightsResponse {
  comfort: string
  schedule_suggestions: ScheduleSuggestion[]
}

export async function getChatInsights(params?: {
  lookback_days?: number
  max_messages?: number
}): Promise<ChatInsightsResponse> {
  const res = await client.post<ChatInsightsResponse>('/journal/chat-insights', params ?? {}, { timeout: 150_000 })
  return res.data
}

// ---------- 日程管理 ----------

export interface Schedule {
  id: number
  user_id: number
  title: string
  scheduled_at: string
  end_at: string | null
  source: string
  raw_text: string | null
  status: string
  created_at: string
}

export async function getSchedules(params?: { startDate?: string; endDate?: string }): Promise<Schedule[]> {
  const res = await client.get<Schedule[]>('/schedules', { params: params ?? {} })
  return res.data ?? []
}

export async function createSchedule(data: { title: string; scheduled_at: string; end_at?: string }): Promise<Schedule> {
  const res = await client.post<Schedule>('/schedules', data)
  return res.data
}

export async function updateSchedule(
  id: number,
  patch: { title?: string; scheduled_at?: string; end_at?: string; status?: string }
): Promise<Schedule> {
  const res = await client.patch<Schedule>(`/schedules/${id}`, patch)
  return res.data
}

export async function deleteSchedule(id: number): Promise<void> {
  await client.delete(`/schedules/${id}`)
}

// ---------- 助理业务流程 ----------

export interface AssistantNoticeCard {
  id: string
  type: string
  priority?: number
  title: string
  subtitle: string
  content: string
  news_items?: InterestNewsItem[]
  news_interests?: string[]
  news_cached_at?: number
}

export async function getAssistantNoticeCards(): Promise<AssistantNoticeCard[]> {
  const res = await client.get<{ cards?: AssistantNoticeCard[] }>('/assistant/notice-cards')
  return res.data?.cards ?? []
}

export interface InterestNewsItem {
  title: string
  link?: string
}

/** 从后端拉取与用户兴趣相关的网络新闻标题（RSS），供聊天里交给模型整理 */
export async function getInterestNewsFromWeb(force = false): Promise<{ interests: string[]; items: InterestNewsItem[]; summary?: string; cached_at?: number }> {
  const res = await client.get<{ interests?: string[]; items?: InterestNewsItem[]; summary?: string; cached_at?: number }>('/assistant/interest-news', {
    params: force ? { force: 1 } : {},
  })
  return {
    interests: res.data?.interests ?? [],
    items: res.data?.items ?? [],
    summary: res.data?.summary,
    cached_at: res.data?.cached_at,
  }
}

/** 点击兴趣新闻卡后记一次消费，后端据此控制“每天最多三次” */
export async function consumeInterestNewsCard(): Promise<void> {
  await client.post('/assistant/interest-news/consume', {})
}

export async function getAssistantChatPrompts(force = false): Promise<{ prompts: string[]; cached_at?: number; expires_at?: number; interests?: string[] }> {
  const res = await client.get<{ prompts?: string[]; cached_at?: number; expires_at?: number; interests?: string[] }>('/assistant/chat-prompts', {
    params: force ? { force: 1 } : {},
  })
  return {
    prompts: Array.isArray(res.data?.prompts) ? res.data!.prompts!.filter(Boolean) : [],
    cached_at: res.data?.cached_at,
    expires_at: res.data?.expires_at,
    interests: res.data?.interests ?? [],
  }
}

// ---------- 人脸识别 + 情绪识别 ----------

export interface FaceStudent {
  id: number
  student_id: string
  name: string
  has_face_feature: boolean
  is_deleted: number
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface FaceDetection {
  student_id: string
  emotion: string
  confidence: number
  box: [number, number, number, number]
}

export interface FaceRecognizeResponse {
  width: number
  height: number
  count: number
  detections: FaceDetection[]
}

export interface FaceRecord {
  id: number
  student_id: string
  emotion_type: string
  intensity: number
  timestamp: string
  is_deleted: number
  deleted_at: string | null
}

export interface FaceWarmupStatusResponse {
  ready: boolean
  status: string
  error?: string | null
}

/** 可选：触发后端预取人脸引擎。页面已改为首次识别/注册惰性加载，一般无需调用。 */
export async function postFaceWarmupStart(): Promise<'already' | 'queued'> {
  const res = await client.post<{ ok?: boolean }>('/face/warmup', {}, { timeout: FACE_WARMUP_HTTP_TIMEOUT_MS })
  if (res.status === 200 && res.data?.ok) return 'already'
  return 'queued'
}

export async function getFaceWarmupStatus(): Promise<FaceWarmupStatusResponse> {
  const res = await client.get<FaceWarmupStatusResponse>('/face/warmup/status', {
    timeout: FACE_WARMUP_HTTP_TIMEOUT_MS,
  })
  const d = res.data
  if (!d) throw new ApiError('无法获取人脸引擎状态', 500)
  return d
}

/** 可选：轮询直到预取完成。一般无需使用（见 postFaceWarmupStart 说明）。 */
export async function warmupFaceEngine(
  onProgress?: (s: FaceWarmupStatusResponse) => void
): Promise<{ ok: boolean; message?: string }> {
  const q = await postFaceWarmupStart()
  if (q === 'already') return { ok: true, message: '人脸引擎已就绪' }
  const deadline = Date.now() + 120 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500))
    const d = await getFaceWarmupStatus()
    onProgress?.(d)
    if (d.ready) return { ok: true, message: '人脸引擎已就绪' }
    if (d.status === 'error' && d.error) throw new ApiError(d.error, 503)
  }
  throw new ApiError('等待人脸模型超时（超过 2 小时），请查看后端终端日志', 504)
}

export async function listFaceStudents(params?: { include_deleted?: boolean; limit?: number }): Promise<FaceStudent[]> {
  const res = await client.get<FaceStudent[]>('/face/students', {
    params: params ?? {},
    timeout: 120_000,
  })
  return res.data ?? []
}

export async function registerFaceStudent(data: {
  student_id: string
  name: string
  image_base64?: string
}): Promise<FaceStudent> {
  // CPU 首次下载权重 + 加载 MTCNN/FaceNet/情绪模型可能需数分钟
  const res = await client.post<FaceStudent>('/face/students', data, { timeout: 600_000 })
  return res.data
}

export async function updateFaceStudent(studentId: string, patch: { name?: string }): Promise<FaceStudent> {
  const res = await client.patch<FaceStudent>(`/face/students/${encodeURIComponent(studentId)}`, patch)
  return res.data
}

export async function deleteFaceStudent(studentId: string): Promise<void> {
  await client.delete(`/face/students/${encodeURIComponent(studentId)}`)
}

export async function recognizeFaceImage(data: {
  image_base64: string
  threshold?: number
}): Promise<FaceRecognizeResponse> {
  const res = await client.post<FaceRecognizeResponse>('/face/recognize', data, { timeout: 600_000 })
  return res.data
}

export async function listFaceRecords(params?: { student_id?: string; limit?: number }): Promise<FaceRecord[]> {
  const res = await client.get<FaceRecord[]>('/face/records', { params: params ?? {} })
  return res.data ?? []
}

export async function deleteFaceRecord(recordId: number): Promise<void> {
  await client.delete(`/face/records/${recordId}`)
}
