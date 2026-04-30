import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import GuestRoute from '@/components/GuestRoute'
import ProtectedRoute from '@/components/ProtectedRoute'
import { useThemeStore } from '@/stores/useThemeStore'
import { useChatStore } from '@/stores/useChatStore'
import { getStoredToken, setStoredToken, getCurrentUser } from '@/utils/api'

const MainLayout = lazy(() => import('@/layouts/MainLayout'))
const LoginPage = lazy(() => import('@/pages/LoginPage'))
const RegisterPage = lazy(() => import('@/pages/RegisterPage'))
const ChatPage = lazy(() => import('@/pages/ChatPage'))
const RealtimeVoiceWindow = lazy(() => import('@/pages/RealtimeVoiceWindow'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))
const FaceMonitorPage = lazy(() => import('@/pages/FaceMonitorPage'))

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="animate-pulse text-gray-500 dark:text-gray-400">加载中...</div>
    </div>
  )
}

function App() {
  const setUser = useChatStore((s) => s.setUser)

  useEffect(() => {
    const cleanup = useThemeStore.getState().init()
    return cleanup
  }, [])

  // 有 token 时尝试恢复登录状态（刷新页面后保持登录）
  const setAuthRestoring = useChatStore((s) => s.setAuthRestoring)
  useEffect(() => {
    if (!getStoredToken()) return
    setAuthRestoring(true)
    getCurrentUser()
      .then((user) => setUser(user))
      .catch(() => {
        setStoredToken(null)
        setUser(null)
      })
      .finally(() => setAuthRestoring(false))
  }, [setUser, setAuthRestoring])

  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route
            path="/login"
            element={
              <GuestRoute>
                <LoginPage />
              </GuestRoute>
            }
          />
          <Route
            path="/register"
            element={
              <GuestRoute>
                <RegisterPage />
              </GuestRoute>
            }
          />

          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<ChatPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="face-monitor" element={<FaceMonitorPage />} />
          </Route>

          <Route
            path="/realtime-window"
            element={<RealtimeVoiceWindow />}
          />

          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
