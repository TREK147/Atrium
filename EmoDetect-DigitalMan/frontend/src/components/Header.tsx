import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { setStoredToken, logout as logoutApi } from '@/utils/api'
import {
  Menu,
  Settings,
  User,
  LogOut,
  ChevronDown,
  Camera,
  ArrowLeft,
} from 'lucide-react'
import type { User as UserType } from '@/types'
import { useChatStore } from '@/stores/useChatStore'
import clsx from 'clsx'

interface HeaderProps {
  onMenuClick?: () => void
  user?: UserType | null
  onSettingsClick?: () => void
}

export default function Header({
  onMenuClick,
  user,
  onSettingsClick,
}: HeaderProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useChatStore((s) => s.logout)
  const showBackToChat = location.pathname.startsWith('/chat/profile')

  const handleLogout = async () => {
    setUserMenuOpen(false)
    try {
      await logoutApi()
    } finally {
      setStoredToken(null)
      logout()
      navigate('/login', { replace: true })
    }
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <header className="flex-shrink-0 h-12 sm:h-14 px-3 sm:px-4 md:px-6 flex items-center justify-between border-b border-gray-200 bg-white dark:border-zinc-700/60 dark:bg-[#121212]">
      <div className="flex items-center gap-1 sm:gap-2 min-w-0">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="lg:hidden p-2 -ml-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-zinc-800/70 touch-manipulation"
            aria-label="打开侧边栏"
          >
            <Menu className="w-5 h-5 sm:w-5 sm:h-5" />
          </button>
        )}
        {showBackToChat && (
          <Link
            to="/chat"
            className="inline-flex items-center gap-1.5 px-2 py-1.5 ml-10 sm:ml-12 rounded-lg text-xs sm:text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800/70 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            返回聊天
          </Link>
        )}
      </div>

      <nav className="flex items-center gap-1 sm:gap-2">
        <Link
          to="/chat/face-monitor"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs sm:text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800/70 transition-colors"
        >
          <Camera className="w-4 h-4" />
          人脸情绪
        </Link>
        <button
          type="button"
          onClick={onSettingsClick}
          className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-zinc-800/70 transition-colors"
          aria-label="设置"
        >
          <Settings className="w-5 h-5" />
        </button>

        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex items-center gap-2 p-1.5 pr-2 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800/70 transition-colors"
            aria-expanded={userMenuOpen}
            aria-haspopup="true"
            data-guide="header-avatar-trigger"
          >
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt=""
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
                <User className="w-4 h-4 text-primary-600 dark:text-primary-400" />
              </div>
            )}
            <span className="hidden sm:block text-sm font-medium text-gray-700 dark:text-gray-300 max-w-[80px] md:max-w-[120px] truncate">
              {user ? user.username : '未登录'}
            </span>
            <ChevronDown
              className={clsx(
                'w-4 h-4 text-gray-500 transition-transform',
                userMenuOpen && 'rotate-180'
              )}
            />
          </button>

          {userMenuOpen && (
            <div
              className="absolute right-0 top-full mt-1 py-1 w-48 min-w-[180px] max-w-[min(100vw-2rem,240px)] rounded-lg bg-white dark:bg-[#1a1a1c] border border-gray-200 dark:border-zinc-700/60 shadow-lg z-50"
              role="menu"
            >
              {user ? (
                <>
                  <div className="px-3 py-2 border-b border-gray-100 dark:border-zinc-700/60">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                      {user.username}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {user.email}
                    </p>
                  </div>
                  <Link
                    to="/chat/profile"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800/70"
                    role="menuitem"
                    onClick={() => setUserMenuOpen(false)}
                    data-guide="header-profile-entry"
                  >
                    <User className="w-4 h-4" />
                    个人中心
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800/70 text-left"
                    role="menuitem"
                  >
                    <LogOut className="w-4 h-4" />
                    退出登录
                  </button>
                </>
              ) : (
                <Link
                  to="/login"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800/70"
                  role="menuitem"
                  onClick={() => setUserMenuOpen(false)}
                >
                  <User className="w-4 h-4" />
                  登录 / 注册
                </Link>
              )}
            </div>
          )}
        </div>
      </nav>
    </header>
  )
}
