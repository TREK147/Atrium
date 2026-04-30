import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useChatStore } from '@/stores/useChatStore'
import { register as registerApi, ApiError } from '@/utils/api'

export default function RegisterPage() {
  const [username, setUsername] = useState('')
  const [studentId, setStudentId] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const setUser = useChatStore((s) => s.setUser)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    if (password.length < 6) {
      setError('密码至少 6 位')
      return
    }
    if (!username.trim()) {
      setError('请输入姓名')
      return
    }
    if (!/^20\d{8}$/.test(studentId.trim())) {
      setError('请输入正确学号（20开头10位数字）')
      return
    }

    setLoading(true)
    try {
      const res = await registerApi({
        username: username.trim(),
        student_id: studentId.trim(),
        password,
      })
      setUser(res.user)
      navigate('/chat', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '注册失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center bg-primary-50 px-3 py-6 sm:px-6 sm:py-8 md:px-8 md:py-10 lg:px-8 lg:py-12 portrait:py-8 landscape:max-md:py-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-gray-800 rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-6 md:p-8 border border-gray-100 dark:border-gray-700">
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-800 dark:text-white text-center mb-4 sm:mb-6">
            注册
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
                htmlFor="username"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
              >
                姓名
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入姓名"
                required
                autoComplete="username"
                className="w-full px-3 sm:px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-shadow text-base"
              />
            </div>

            <div>
              <label
                htmlFor="studentId"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
              >
                学号
              </label>
              <input
                id="studentId"
                type="text"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                placeholder="请输入学号（20开头10位）"
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
                placeholder="至少 6 位"
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full px-3 sm:px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-shadow text-base"
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
              >
                确认密码
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入密码"
                required
                autoComplete="new-password"
                className="w-full px-3 sm:px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-shadow text-base"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-lg bg-primary-500 text-white text-base font-medium hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-colors active:scale-[0.98] disabled:opacity-60 disabled:pointer-events-none"
            >
              {loading ? '注册中…' : '注册'}
            </button>
          </form>

          <p className="mt-4 sm:mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
            已有账号？{' '}
            <Link
              to="/login"
              className="font-medium text-primary-600 hover:text-primary-500 transition-colors"
            >
              去登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
