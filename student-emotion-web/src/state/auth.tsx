import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { DataScope, RoleCode, UserAccountStatus } from '../mock/types'
import { api } from '../mock/api'

export type SafeUser = {
  id: string
  staffNo: string
  name: string
  role: RoleCode
  roleName: string
  scope?: DataScope
  scopes?: DataScope[]
  status: UserAccountStatus
  failedLoginCount: number
  lockedUntil?: number
  createdAt: number
  lastLoginAt?: number
}

type AuthState = {
  token?: string
  user?: SafeUser
  loading: boolean
  refresh: () => Promise<void>
  setToken: (t?: string) => void
  logout: () => Promise<void>
}

const AuthCtx = createContext<AuthState | null>(null)

const TOKEN_KEY = 'sem_token'

export function AuthProvider(props: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | undefined>(() => localStorage.getItem(TOKEN_KEY) || undefined)
  const [user, setUser] = useState<SafeUser | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  const setToken = useCallback((t?: string) => {
    setTokenState(t)
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    const r = await api.me(token)
    if (r.ok) setUser(r.data as SafeUser)
    else setUser(undefined)
    setLoading(false)
  }, [token])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    await api.logout(token)
    setToken(undefined)
    setUser(undefined)
  }, [token, setToken])

  const value = useMemo<AuthState>(
    () => ({ token, user, loading, refresh, setToken, logout }),
    [token, user, loading, refresh, setToken, logout],
  )

  return <AuthCtx.Provider value={value}>{props.children}</AuthCtx.Provider>
}

export function useAuth() {
  const v = useContext(AuthCtx)
  if (!v) throw new Error('useAuth must be used within AuthProvider')
  return v
}

