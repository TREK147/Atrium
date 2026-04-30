import { Navigate, useLocation } from 'react-router-dom'
import { useChatStore } from '@/stores/useChatStore'

interface ProtectedRouteProps {
  children: React.ReactNode
}

/** 需登录才能访问，未登录时重定向到 /login */
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const isLoggedIn = useChatStore((s) => s.isLoggedIn())
  const authRestoring = useChatStore((s) => s.authRestoring)
  const location = useLocation()

  if (authRestoring) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-pulse text-gray-500 dark:text-gray-400">登录状态恢复中...</div>
      </div>
    )
  }
  if (!isLoggedIn) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
