import { Navigate } from 'react-router-dom'
import { useChatStore } from '@/stores/useChatStore'

interface GuestRouteProps {
  children: React.ReactNode
}

/** 仅未登录可访问，已登录时重定向到 /chat */
export default function GuestRoute({ children }: GuestRouteProps) {
  const isLoggedIn = useChatStore((s) => s.isLoggedIn())

  if (isLoggedIn) {
    return <Navigate to="/chat" replace />
  }

  return <>{children}</>
}
