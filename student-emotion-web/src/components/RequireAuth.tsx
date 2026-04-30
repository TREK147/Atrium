import { Spin, Result, Button } from 'antd'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../state/auth'

export function RequireAuth(props: { children: React.ReactNode }) {
  const { token, user, loading, logout } = useAuth()
  const loc = useLocation()

  if (!token) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (loading)
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
        <Spin size="large" />
      </div>
    )
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />

  if (user.status !== 'ACTIVE') {
    return (
      <div style={{ padding: 24 }}>
        <Result
          status="warning"
          title="账号不可用"
          subTitle={`当前账号状态：${user.status}（可能已被管理员冻结/停用或锁定）。`}
          extra={
            <Button
              onClick={() => {
                void logout()
              }}
            >
              退出登录
            </Button>
          }
        />
      </div>
    )
  }

  return <>{props.children}</>
}

