import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../state/auth'

/** 仅超级管理员或未绑定学院的全校级管理员可访问（阈值、审计、用户反馈等） */
export function RequireSemFullAdmin(props: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  const full =
    user?.staffNo === 'SuperManager' ||
    (user?.role === 'ADMIN' && !(user?.scope?.collegeId || user?.scope?.collegeName))
  if (!full) return <Navigate to="/dashboard" replace />
  return <>{props.children}</>
}
