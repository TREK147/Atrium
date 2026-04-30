import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import Toast from '@/components/Toast'
import { useChatStore } from '@/stores/useChatStore'
import { useToastStore } from '@/stores/useToastStore'
import {
  getConversations,
  createConversation,
  getMessages,
  deleteConversation,
  patchConversation,
  setPreferredName,
  invalidateConversationsCache,
  submitUserFeedback,
  uploadFile,
} from '@/utils/api'
import { X, Sun, Moon, Monitor, Send, CircleHelp, Sparkles, ChevronRight, Shield, ChevronLeft } from 'lucide-react'
import clsx from 'clsx'
import DigitalHuman from '@/components/DigitalHuman'
import { useThemeStore } from '@/stores/useThemeStore'
import { type ThemeMode } from '@/utils/theme'

export default function MainLayout() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')
  const [feedbackScreenshot, setFeedbackScreenshot] = useState<{ url: string; name: string } | null>(null)
  const [feedbackAllowContact, setFeedbackAllowContact] = useState(false)
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [aiPersonalizationEnabled, setAiPersonalizationEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('ai-personalization-enabled') !== '0'
    } catch {
      return true
    }
  })
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const [preferredNameInput, setPreferredNameInput] = useState('')
  const [welcomeSaving, setWelcomeSaving] = useState(false)
  const toast = useToastStore((s) => s.show)
  const user = useChatStore((s) => s.user)
  const sidebarOpen = useChatStore((s) => s.sidebarOpen)
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen)
  const conversations = useChatStore((s) => s.conversations)
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const addConversation = useChatStore((s) => s.addConversation)
  const setConversations = useChatStore((s) => s.setConversations)
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId)
  const setMessages = useChatStore((s) => s.setMessages)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const removeConversation = useChatStore((s) => s.removeConversation)
  const updateConversation = useChatStore((s) => s.updateConversation)
  const setUser = useChatStore((s) => s.setUser)

  const authRestoring = useChatStore((s) => s.authRestoring)
  const { mode, setMode } = useThemeStore()

  const THEME_MODE_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: '浅色', icon: Sun },
    { value: 'dark', label: '深色', icon: Moon },
    { value: 'system', label: '跟随系统', icon: Monitor },
  ]

  // 登录/恢复后：从服务端拉取会话列表（切换账号时先清缓存，避免读到上一账号的对话）
  useEffect(() => {
    if (authRestoring || !user) return
    invalidateConversationsCache()
    getConversations()
      .then((list) => {
        setConversations(list)
        setCurrentConversationId(null)
        clearMessages()
      })
      .catch(() => {
        setConversations([])
        setCurrentConversationId(null)
        clearMessages()
      })
  }, [user?.id, authRestoring, setConversations, setCurrentConversationId, clearMessages])

  useEffect(() => {
    if (!user) return
    if (user.onboarding_done) {
      setWelcomeOpen(false)
      return
    }
    setPreferredNameInput((user.preferred_name || user.username || '').trim())
    setWelcomeOpen(true)
  }, [user?.id, user?.onboarding_done, user?.preferred_name, user?.username])

  // 兼容老账号：若从未写入过新手引导标记，也给一次引导体验
  useEffect(() => {
    if (!user?.id) return
    // 首次登录尚未完成称呼设置时，不提前触发新手引导
    if (user.onboarding_done === false) return
    const chatKey = `newbie-guide-chat-pending:${user.id}`
    const profileKey = `newbie-guide-profile-pending:${user.id}`
    const hasChat = window.localStorage.getItem(chatKey)
    const hasProfile = window.localStorage.getItem(profileKey)
    if (hasChat === null && hasProfile === null) {
      window.localStorage.setItem(chatKey, '1')
    }
  }, [user?.id])

  const handleNewConversation = async () => {
    try {
      const conv = await createConversation({ title: '新对话' })
      addConversation(conv)
      setCurrentConversationId(conv.id)
      clearMessages()
    } catch {
      // 创建失败时仍可在前端新建本地会话，但无法持久化；这里简单清空当前
      setCurrentConversationId(null)
      clearMessages()
    }
  }

  const handleSelectConversation = async (id: string) => {
    setCurrentConversationId(id)
    try {
      const list = await getMessages(id)
      setMessages(list)
    } catch {
      setMessages([])
    }
  }

  const handleRemoveConversation = async (id: string) => {
    try {
      await deleteConversation(id)
      removeConversation(id)
    } catch {
      removeConversation(id)
    }
  }

  const handleUpdateConversation = async (id: string, patch: { title?: string; lastMessage?: string; updatedAt?: Date; messageCount?: number; pinned?: boolean }) => {
    updateConversation(id, patch)
    if (patch.title !== undefined || patch.pinned !== undefined) {
      try {
        await patchConversation(id, { title: patch.title, pinned: patch.pinned })
      } catch {
        // 忽略
      }
    }
  }

  const handleSubmitPreferredName = async () => {
    const name = preferredNameInput.trim()
    if (!name) return
    setWelcomeSaving(true)
    try {
      const refreshed = await setPreferredName(name)
      setUser(refreshed)
      if (refreshed?.id) {
        window.localStorage.setItem(`newbie-guide-chat-pending:${refreshed.id}`, '1')
      }
      setWelcomeOpen(false)
    } catch {
      // ignore
    } finally {
      setWelcomeSaving(false)
    }
  }

  const handleToggleAiPersonalization = () => {
    setAiPersonalizationEnabled((prev) => {
      const next = !prev
      window.localStorage.setItem('ai-personalization-enabled', next ? '1' : '0')
      toast(next ? '已开启个性化智能服务' : '已关闭个性化智能服务')
      return next
    })
  }

  const handlePickFeedbackScreenshot = async (file?: File) => {
    if (!file) return
    try {
      const uploaded = await uploadFile(file)
      setFeedbackScreenshot({ url: uploaded.url, name: uploaded.fileName })
    } catch {
      toast('截图上传失败，请重试')
    }
  }

  const handleSubmitFeedback = async () => {
    const content = feedbackText.trim()
    if (!content) {
      toast('请填写反馈内容')
      return
    }
    setFeedbackSubmitting(true)
    try {
      await submitUserFeedback({
        content,
        screenshotUrl: feedbackScreenshot?.url,
        allowContact: feedbackAllowContact,
      })
      toast('反馈已提交，感谢你的建议')
      setFeedbackOpen(false)
      setFeedbackText('')
      setFeedbackScreenshot(null)
      setFeedbackAllowContact(false)
    } catch {
      toast('反馈提交失败，请稍后重试')
    } finally {
      setFeedbackSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-screen min-h-[100dvh] max-h-[100dvh] overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <Header
        user={user}
        onSettingsClick={() => setSettingsOpen(true)}
      />

      {/* 设置弹层 */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setSettingsOpen(false)}>
          <div className="bg-white dark:bg-[#1a1a1c] rounded-xl shadow-xl max-w-sm w-full p-6 border border-gray-200 dark:border-zinc-700/60" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-white">设置</h2>
              <button type="button" onClick={() => setSettingsOpen(false)} className="p-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800/70" aria-label="关闭">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">外观</p>
                <div className="flex flex-col sm:flex-row gap-1">
                  {THEME_MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setMode(value)}
                      className={clsx(
                        'flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-sm transition-colors min-w-0',
                        mode === value
                          ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="pt-1 border-t border-gray-200 dark:border-zinc-700/60 space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setFeedbackOpen(true)
                    setSettingsOpen(false)
                  }}
                  className="w-full flex items-center justify-between px-2 py-2 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-800/70"
                >
                  <span className="inline-flex items-center gap-2 text-sm">
                    <Send className="w-4 h-4" />
                    发送反馈
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHelpOpen(true)
                    setSettingsOpen(false)
                  }}
                  className="w-full flex items-center justify-between px-2 py-2 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-800/70"
                >
                  <span className="inline-flex items-center gap-2 text-sm">
                    <CircleHelp className="w-4 h-4" />
                    帮助
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>
                <button
                  type="button"
                  onClick={handleToggleAiPersonalization}
                  className="w-full flex items-center justify-between px-2 py-2 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-800/70"
                >
                  <span className="inline-flex items-center gap-2 text-sm">
                    <Sparkles className="w-4 h-4" />
                    个性化智能服务
                  </span>
                  <span className={clsx('text-xs', aiPersonalizationEnabled ? 'text-emerald-500' : 'text-gray-400')}>
                    {aiPersonalizationEnabled ? '已开启' : '已关闭'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {helpOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => setHelpOpen(false)}>
          <div
            className="bg-white dark:bg-[#1a1a1c] rounded-xl shadow-xl max-w-sm w-full p-6 border border-gray-200 dark:border-zinc-700/60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => {
                  setHelpOpen(false)
                  setSettingsOpen(true)
                }}
                className="p-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800/70"
                aria-label="返回上一级"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <h2 className="text-lg font-semibold text-gray-800 dark:text-white">帮助</h2>
              <button type="button" onClick={() => setHelpOpen(false)} className="p-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800/70" aria-label="关闭">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2">
              <button type="button" className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800/70 text-left">
                <span className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <CircleHelp className="w-4 h-4" />
                  帮助中心
                </span>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </button>
              <button type="button" className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800/70 text-left">
                <span className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <Shield className="w-4 h-4" />
                  隐私权
                </span>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">帮助内容即将上线，当前仅提供入口壳。</p>
          </div>
        </div>
      )}

      {feedbackOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => setFeedbackOpen(false)}>
          <div
            className="bg-white dark:bg-[#1a1a1c] rounded-xl shadow-xl max-w-lg w-full p-6 border border-gray-200 dark:border-zinc-700/60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => {
                  setFeedbackOpen(false)
                  setSettingsOpen(true)
                }}
                className="p-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800/70"
                aria-label="返回上一级"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <h2 className="text-lg font-semibold text-gray-800 dark:text-white">向我们发送反馈</h2>
              <button type="button" onClick={() => setFeedbackOpen(false)} className="p-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800/70" aria-label="关闭">
                <X className="w-5 h-5" />
              </button>
            </div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-2">
              请描述您的反馈（必填）
            </label>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="请告诉我们是什么原因促使您提供此反馈..."
              maxLength={2000}
              className="w-full h-40 px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700/60 bg-white dark:bg-[#131316] text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">请勿包含任何敏感信息</p>
            <div className="mt-4">
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">截图可以帮助我们更好地了解您的反馈。</p>
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700/60 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-800/70 cursor-pointer">
                <span>上传截图</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handlePickFeedbackScreenshot(e.target.files?.[0])}
                />
              </label>
              {feedbackScreenshot && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">已附加：{feedbackScreenshot.name}</p>
              )}
            </div>
            <label className="mt-4 inline-flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={feedbackAllowContact}
                onChange={(e) => setFeedbackAllowContact(e.target.checked)}
                className="mt-0.5"
              />
              <span>我们可能会给您发送电子邮件，向您了解更多信息或最新动态</span>
            </label>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => void handleSubmitFeedback()}
                disabled={feedbackSubmitting || !feedbackText.trim()}
                className="px-5 py-2 rounded-lg bg-primary-600 text-white text-sm hover:bg-primary-700 disabled:opacity-60"
              >
                {feedbackSubmitting ? '发送中…' : '发送'}
              </button>
            </div>
          </div>
        </div>
      )}

      {welcomeOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/55" onClick={(e) => e.preventDefault()}>
          <div className="bg-white dark:bg-[#1a1a1c] rounded-2xl shadow-xl max-w-md w-full p-5 border border-gray-200 dark:border-zinc-700/60">
            <div className="flex justify-center mb-2">
              <DigitalHuman expression="happy" minimal className="max-w-[140px]" />
            </div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-2 text-center">你好呀，我是小Q</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              你的情感管家，不仅可以和你聊天解闷，还能给你管理日程等，很高兴认识你。请问你想我叫你什么呀？
            </p>
            <div className="mt-4">
              <input
                value={preferredNameInput}
                onChange={(e) => setPreferredNameInput(e.target.value)}
                placeholder="例如：一川"
                maxLength={50}
                autoFocus
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-zinc-700/60 bg-white dark:bg-[#131316] text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                type="button"
                onClick={handleSubmitPreferredName}
                disabled={welcomeSaving || !preferredNameInput.trim()}
                className="mt-3 w-full py-2.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60"
              >
                {welcomeSaving ? '保存中…' : '就叫我这个吧'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast />

      {/* 主体：侧边栏 + 主内容区 */}
      <div className="flex flex-1 min-h-0">
        <Sidebar
          user={user}
          conversations={conversations}
          currentConversationId={currentConversationId}
          onNewConversation={handleNewConversation}
          onSelectConversation={handleSelectConversation}
          onRemoveConversation={handleRemoveConversation}
          onUpdateConversation={handleUpdateConversation}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onOpen={() => setSidebarOpen(true)}
        />

        {/* 主内容区域（左侧条 56px 常驻，展开面板时 56+280px） */}
        <main
          className="flex-1 flex flex-col min-w-0 bg-slate-50/40 dark:bg-[#0f0f10] overflow-hidden transition-[padding-left] duration-200 ease-out"
          style={{ paddingLeft: sidebarOpen ? 336 : 56 }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}
