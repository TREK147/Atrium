import { Result } from 'antd'
import type { RoleCode } from '../mock/types'
import { useAuth } from '../state/auth'

export function RequireRole(props: { allow: RoleCode[]; children: React.ReactNode }) {
  const { user } = useAuth()
  if (!user) return null
  if (!props.allow.includes(user.role)) {
    return <Result status="403" title="403" subTitle="无权限访问该页面" />
  }
  return <>{props.children}</>
}

