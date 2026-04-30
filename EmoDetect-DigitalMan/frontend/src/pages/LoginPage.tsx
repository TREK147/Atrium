import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatStore } from '@/stores/useChatStore'
import { login as loginApi, ApiError } from '@/utils/api'

export default function LoginPage() {
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const setUser = useChatStore((s) => s.setUser)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await loginApi({ account, password })
      setUser(res.user)
      navigate('/chat', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center bg-primary-50 px-3 py-6 sm:px-6 sm:py-8 md:px-8 md:py-10 lg:px-8 lg:py-12 portrait:py-8 landscape:max-md:py-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-gray-800 rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-6 md:p-8 border border-gray-100 dark:border-gray-700">
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-800 dark:text-white text-center mb-4 sm:mb-6">
            登录
          </h1>

          {error && (
            <div
              className="mb-4 py-2.5 px-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm"
              role="alert"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            <div>
              <label
                htmlFor="account"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
              >
                学号
              </label>
              <input
                id="account"
                type="text"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="请输入学号"
                required
                autoComplete="username"
                className="w-full px-3 sm:px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-shadow text-base"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
              >
                密码
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                required
                autoComplete="current-password"
                className="w-full px-3 sm:px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-shadow text-base"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-lg bg-primary-500 text-white text-base font-medium hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-colors active:scale-[0.98] disabled:opacity-60 disabled:pointer-events-none"
            >
              {loading ? '登录中…' : '登录'}
            </button>
          </form>

        </div>
      </div>
    </div>
  )
}
