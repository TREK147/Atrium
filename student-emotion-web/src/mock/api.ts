import type { AlertItem, AuditLog, DataScope, RoleCode, ThresholdConfig, User, UserAccountStatus } from './types'

type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

async function parse<T>(res: Response): Promise<ApiResult<T>> {
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { ok: false, code: 'PARSE', message: '响应不是合法 JSON' }
  }
  if (body && typeof body === 'object' && 'ok' in body) {
    return body as ApiResult<T>
  }
  return { ok: false, code: 'UNKNOWN', message: '未知响应格式' }
}

function authHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function get<T>(path: string, token?: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders(token) })
    return await parse<T>(res)
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: e instanceof Error ? e.message : String(e) }
  }
}

async function post<T>(path: string, body: unknown, token?: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body ?? {}),
    })
    return await parse<T>(res)
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: e instanceof Error ? e.message : String(e) }
  }
}

async function del<T>(path: string, token?: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: authHeaders(token) })
    return await parse<T>(res)
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: e instanceof Error ? e.message : String(e) }
  }
}

export const api = {
  async login(params: {
    staffNo: string
    password: string
  }): Promise<ApiResult<{ token: string; role: RoleCode; roleName: string }>> {
    return post('/api/auth/login', {
      staffNo: params.staffNo,
      password: params.password,
    })
  },

  async logout(tokenStr?: string): Promise<ApiResult<true>> {
    return post('/api/auth/logout', {}, tokenStr)
  },

  async me(tokenStr?: string): Promise<ApiResult<Omit<User, 'passwordHash' | 'passwordSalt'>>> {
    return get('/api/auth/me', tokenStr)
  },

  async changePassword(tokenStr: string | undefined, params: { oldPassword: string; newPassword: string }) {
    return post<true>('/api/auth/change-password', params, tokenStr)
  },

  async adminListAccounts(tokenStr?: string) {
    return get<
      Array<{
        id: string
        staffNo: string
        name: string
        role: RoleCode
        roleName: string
        scope?: DataScope
        status: UserAccountStatus
        failedLoginCount: number
        lockedUntil?: number
        lastLoginAt?: number
      }>
    >('/api/admin/accounts', tokenStr)
  },

  async adminSetAccountStatus(tokenStr: string | undefined, params: { staffNo: string; status: UserAccountStatus }) {
    return post<true>('/api/admin/accounts/status', params, tokenStr)
  },

  async adminCreateAccount(
    tokenStr: string | undefined,
    params: {
      staffNo: string
      name: string
      role: RoleCode
      roleName: string
      initPassword: string
      scope?: DataScope
    },
  ) {
    return post<true>('/api/admin/accounts/create', params, tokenStr)
  },

  async adminResetAccountPassword(
    tokenStr: string | undefined,
    params: {
      staffNo: string
      newPassword: string
    },
  ) {
    return post<true>('/api/admin/accounts/reset-password', params, tokenStr)
  },

  async adminUpdateRoleScope(
    tokenStr: string | undefined,
    params: { staffNo: string; role: RoleCode; roleName: string; scope?: DataScope; scopes?: DataScope[] },
  ) {
    return post<true>('/api/admin/role-scope', params, tokenStr)
  },

  async adminGetThreshold(tokenStr?: string) {
    return get<ThresholdConfig>('/api/admin/thresholds', tokenStr)
  },

  async adminUpdateThreshold(tokenStr: string | undefined, cfg: Omit<ThresholdConfig, 'updatedAt' | 'updatedBy'>) {
    return post<ThresholdConfig>('/api/admin/thresholds', cfg, tokenStr)
  },

  async adminListAuditLogs(tokenStr?: string) {
    return get<AuditLog[]>('/api/admin/audit-logs', tokenStr)
  },

  async adminListUserFeedback(tokenStr?: string) {
    return get<import('./types').UserFeedback[]>('/api/admin/user-feedback', tokenStr)
  },

  async adminDeleteUserFeedback(tokenStr: string | undefined, feedbackId: number) {
    return del<true>(`/api/admin/user-feedback/${encodeURIComponent(String(feedbackId))}`, tokenStr)
  },

  async submitFeedback(
    tokenStr: string | undefined,
    params: { content: string; allowContact?: boolean; contactEmail?: string; screenshotUrl?: string },
  ) {
    return post<{ id: number }>(
      '/api/feedback',
      {
        content: params.content,
        allow_contact: params.allowContact ? 1 : 0,
        contact_email: params.contactEmail,
        screenshot_url: params.screenshotUrl,
      },
      tokenStr,
    )
  },

  async counselorSearchStudents(
    tokenStr: string | undefined,
    params: { keyword?: string; studentNo?: string; name?: string },
  ) {
    const q = new URLSearchParams()
    if (params.keyword) q.set('keyword', params.keyword)
    if (params.studentNo) q.set('studentNo', params.studentNo)
    if (params.name) q.set('name', params.name)
    const qs = q.toString()
    return get<Array<import('./types').StudentBase>>(`/api/counselor/students${qs ? `?${qs}` : ''}`, tokenStr)
  },

  async counselorGetStudentArchive(tokenStr: string | undefined, studentNo: string) {
    return get<{
      student: import('./types').StudentBase
      timeline: Array<{ ts: number; score: number; mood: '积极' | '中性' | '消极'; source: string }>
      reports: import('./types').AssessmentReport[]
    }>(`/api/counselor/students/${encodeURIComponent(studentNo)}/archive`, tokenStr)
  },

  async counselorGetVisualization(tokenStr: string | undefined, params: { range: 'week' | 'month' | 'term' }) {
    return get<{
      scopeLabel: string
      todayAvg: number
      distribution: Record<string, number>
      distributionStudents?: Record<'积极' | '中性' | '消极', Array<{ studentNo: string; name: string }>>
      trend: Array<{ ts: number; avg: number }>
      visibleCount: number
    }>(`/api/counselor/visualization?range=${encodeURIComponent(params.range)}`, tokenStr)
  },

  async counselorListAlerts(tokenStr?: string) {
    return get<AlertItem[]>('/api/counselor/alerts', tokenStr)
  },

  async counselorUpdateAlert(tokenStr: string | undefined, params: { id: string; status: AlertItem['status']; note?: string }) {
    return post<true>(
      `/api/counselor/alerts/${encodeURIComponent(params.id)}`,
      { status: params.status, note: params.note },
      tokenStr,
    )
  },
}
