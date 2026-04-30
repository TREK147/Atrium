import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../state/auth'

/** 超级管理员不使用教职工端「意见反馈」提交功能 */
export function RequireNonSuperManager(props: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user?.staffNo === 'SuperManager') {
    return <Navigate to="/dashboard" replace />
  }
  return <>{props.children}</>
}
