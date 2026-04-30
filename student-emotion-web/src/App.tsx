import { ConfigProvider, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { Route, Routes, Navigate } from 'react-router-dom'
import { AuthProvider } from './state/auth'
import { LoginPage } from './pages/LoginPage'
import { MainLayout } from './layouts/MainLayout'
import { RequireAuth } from './components/RequireAuth'
import { RequireRole } from './components/RequireRole'
import { RequireSemFullAdmin } from './components/RequireSemFullAdmin'
import { RequireNonSuperManager } from './components/RequireNonSuperManager'
import { DashboardPage } from './pages/DashboardPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { AccountAdminPage } from './pages/admin/AccountAdminPage'
import { RoleScopeAdminPage } from './pages/admin/RoleScopeAdminPage'
import { ThresholdAdminPage } from './pages/admin/ThresholdAdminPage'
import { AuditLogPage } from './pages/admin/AuditLogPage'
import { UserFeedbackPage } from './pages/admin/UserFeedbackPage'
import { FeedbackSubmitPage } from './pages/FeedbackSubmitPage'
import { StudentArchivePage } from './pages/counselor/StudentArchivePage'
import { AlertCenterPage } from './pages/counselor/AlertCenterPage'

export default function App() {
  return (
    <ConfigProvider locale={zhCN}>
      <AntApp>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <MainLayout />
                </RequireAuth>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route
                path="feedback"
                element={
                  <RequireNonSuperManager>
                    <FeedbackSubmitPage />
                  </RequireNonSuperManager>
                }
              />
              <Route path="change-password" element={<ChangePasswordPage />} />

              <Route
                path="counselor/archive"
                element={
                  <RequireRole allow={['COUNSELOR', 'ADMIN']}>
                    <StudentArchivePage />
                  </RequireRole>
                }
              />
              <Route
                path="counselor/alerts"
                element={
                  <RequireRole allow={['COUNSELOR', 'ADMIN']}>
                    <AlertCenterPage />
                  </RequireRole>
                }
              />

              <Route
                path="admin/accounts"
                element={
                  <RequireRole allow={['ADMIN']}>
                    <AccountAdminPage />
                  </RequireRole>
                }
              />
              <Route
                path="admin/role-scope"
                element={
                  <RequireRole allow={['ADMIN']}>
                    <RoleScopeAdminPage />
                  </RequireRole>
                }
              />
              <Route
                path="admin/thresholds"
                element={
                  <RequireRole allow={['ADMIN']}>
                    <RequireSemFullAdmin>
                      <ThresholdAdminPage />
                    </RequireSemFullAdmin>
                  </RequireRole>
                }
              />
              <Route
                path="admin/audit"
                element={
                  <RequireRole allow={['ADMIN']}>
                    <RequireSemFullAdmin>
                      <AuditLogPage />
                    </RequireSemFullAdmin>
                  </RequireRole>
                }
              />
              <Route
                path="admin/feedback"
                element={
                  <RequireRole allow={['ADMIN']}>
                    <RequireSemFullAdmin>
                      <UserFeedbackPage />
                    </RequireSemFullAdmin>
                  </RequireRole>
                }
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </AntApp>
    </ConfigProvider>
  )
}
