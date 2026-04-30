import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  getSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  listWeeklyJournals,
  generateWeeklyJournal,
  generateWeeklySummary,
  getChatInsights,
  type Schedule,
  type WeeklyJournal,
  type WeeklyJournalSummary,
  type ScheduleSuggestion,
} from '@/utils/api'
import { User, Mail, Calendar, ChevronLeft, ChevronRight, Plus, BookOpen, Sparkles } from 'lucide-react'
import { useChatStore } from '@/stores/useChatStore'
import { useToastStore } from '@/stores/useToastStore'
import { dedupeSchedulesForDisplay } from '@/utils/scheduleDedupe'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] // 周一到周日
/** 早8-晚10，每小时一格，共14格 */
const SLOT_LABELS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00']
const EVENT_COLORS = ['bg-blue-400', 'bg-amber-400', 'bg-emerald-400', 'bg-violet-400', 'bg-rose-400', 'bg-sky-400']

/** 获取某天所在周的周一 00:00 */
function getWeekMonday(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

/** 用本地日期避免 UTC 导致“晚一天” */
function toLocalDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 心情展示：统一为「当天情绪：阴」，避免与模型返回前缀重复 */
function formatDayMoodLabel(mood: string): string {
  let m = (mood || '').trim()
  m = m.replace(/^(今日心情|当天情绪)[：:]\s*/u, '')
  return m ? `当天情绪：${m}` : '当天情绪：—'
}

export default function ProfilePage() {
  const location = useLocation()
  const user = useChatStore((s) => s.user)
  const toast = useToastStore((s) => s.show)
  const isStudentIdAccount = useMemo(() => /^20\d{8}$/.test((user?.email || '').trim()), [user?.email])

  const [journals, setJournals] = useState<WeeklyJournal[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [generatingJournal, setGeneratingJournal] = useState(false)
  const [weeklyDiaryOpen, setWeeklyDiaryOpen] = useState(false)
  const [weeklySummary, setWeeklySummary] = useState<WeeklyJournalSummary | null>(null)
  const [weeklySummaryLoading, setWeeklySummaryLoading] = useState(false)
  const [insightOpen, setInsightOpen] = useState(false)
  const [insightLoading, setInsightLoading] = useState(false)
  const [insightComfort, setInsightComfort] = useState('')
  const [insightSuggestions, setInsightSuggestions] = useState<ScheduleSuggestion[]>([])
  const [insightSelected, setInsightSelected] = useState<boolean[]>([])
  const [pageVisible, setPageVisible] = useState(false)
  /** 周视图：当前显示的周的周一 */
  const [weekMonday, setWeekMonday] = useState<Date>(() => getWeekMonday(new Date()))
  /** 新增日程弹窗：打开时记录点击的格子 (dayIndex, slotIndex) */
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addModalDay, setAddModalDay] = useState(0)
  const [addModalSlot, setAddModalSlot] = useState(0)
  const [addFormName, setAddFormName] = useState('')
  const [addFormLocation, setAddFormLocation] = useState('')
  const [addFormNotes, setAddFormNotes] = useState('')
  /** 编辑日程弹窗 */
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null)
  const [editFormName, setEditFormName] = useState('')
  const [editFormLocation, setEditFormLocation] = useState('')
  const [editFormNotes, setEditFormNotes] = useState('')
  const [guideStep, setGuideStep] = useState<number>(-1)
  const [guideHighlightRect, setGuideHighlightRect] = useState<DOMRect | null>(null)
  const weekDiarySectionRef = useRef<HTMLElement | null>(null)
  const firstDiaryItemRef = useRef<HTMLLIElement | null>(null)
  const generateWeekBtnRef = useRef<HTMLButtonElement | null>(null)

  const load = async () => {
    if (!user) return
    setLoading(true)
    try {
      const j = await listWeeklyJournals(24)
      setJournals(j)
    } catch {
      setJournals([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return
    const qs = new URLSearchParams(location.search)
    const byQuery = qs.get('guide') === '1'
    const byStorage = window.localStorage.getItem(`newbie-guide-profile-pending:${user.id}`) === '1'
    if (byQuery || byStorage) {
      setWeeklyDiaryOpen(false)
      setGuideStep(0)
    }
  }, [location.search, user?.id])

  useEffect(() => {
    if (location.hash === '#schedule-section') {
      // 增加重试机制，确保元素渲染后能找到并滚动
      let attempts = 0
      const scrollToEl = () => {
        const el = document.getElementById('schedule-section')
        // 找到滚动的容器，ProfilePage 的外层 div
        const container = document.getElementById('profile-scroll-container')
        if (el && container) {
          // 计算元素相对于容器的偏移量
          const y = el.offsetTop - 20
          container.scrollTo({ top: y, behavior: 'smooth' })
        } else if (attempts < 10) {
          attempts++
          setTimeout(scrollToEl, 100)
        }
      }
      setTimeout(scrollToEl, 100)
    }
  }, [location.hash, loading])

  useEffect(() => {
    setPageVisible(false)
    const raf = window.requestAnimationFrame(() => {
      setPageVisible(true)
    })
    return () => {
      window.cancelAnimationFrame(raf)
    }
  }, [location.key])

  useEffect(() => {
    if (guideStep < 0) {
      setGuideHighlightRect(null)
      return
    }
    const getGuideTarget = (): HTMLElement | null => {
      if (guideStep === 0) return weekDiarySectionRef.current
      if (guideStep === 1) return firstDiaryItemRef.current ?? weekDiarySectionRef.current
      if (guideStep === 2) return generateWeekBtnRef.current
      if (guideStep === 3) {
        return document.getElementById('weekly-diary-dialog-title')?.closest('[role="dialog"]') as HTMLElement | null
      }
      return null
    }
    const measure = () => {
      const target = getGuideTarget()
      setGuideHighlightRect(target ? target.getBoundingClientRect() : null)
    }
    const raf = window.requestAnimationFrame(measure)
    const timer = window.setTimeout(measure, 120)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(timer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [guideStep, weeklyDiaryOpen, generatingJournal, weeklySummaryLoading, journals.length])

  useEffect(() => {
    if (guideStep < 0) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [guideStep])

  useEffect(() => {
    if (guideStep < 0) return
    const blockUnexpectedClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-guide="profile-guide-next"]')) return
      if (guideStep === 2 && target.closest('[data-guide="profile-guide-generate"]')) return
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener('click', blockUnexpectedClick, true)
    return () => {
      document.removeEventListener('click', blockUnexpectedClick, true)
    }
  }, [guideStep])

  /** 按周拉取日程（周一 00:00 到周日 23:59:59） */
  useEffect(() => {
    if (!user) return
    const mon = new Date(weekMonday)
    const sun = new Date(mon)
    sun.setDate(sun.getDate() + 6)
    const start = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')} 00:00:00`
    const end = `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, '0')}-${String(sun.getDate()).padStart(2, '0')} 23:59:59`
    getSchedules({ startDate: start, endDate: end }).then(setSchedules).catch(() => setSchedules([]))
  }, [user?.id, weekMonday.getTime()])

  const openAddModal = (dayIndex: number, slotIndex: number) => {
    setAddModalDay(dayIndex)
    setAddModalSlot(slotIndex)
    setAddFormName('')
    setAddFormLocation('')
    setAddFormNotes('')
    setAddModalOpen(true)
  }

  /** 解析标题 "日程名 - 地点 - 备注" 为三栏 */
  const parseTitle = (title: string): [string, string, string] => {
    const parts = title.split(' - ')
    return [parts[0] ?? '', parts[1] ?? '', parts[2] ?? '']
  }

  const openEditModal = (s: Schedule) => {
    const [name, loc, notes] = parseTitle(s.title)
    setEditingSchedule(s)
    setEditFormName(name)
    setEditFormLocation(loc)
    setEditFormNotes(notes)
    setEditModalOpen(true)
  }

  const handleConfirmEditSchedule = async () => {
    if (!editingSchedule) return
    const name = editFormName.trim()
    if (!name) {
      toast('请填写日程名')
      return
    }
    const loc = editFormLocation.trim()
    const notes = editFormNotes.trim()
    const title = [name, loc, notes].filter(Boolean).join(' - ')
    try {
      await updateSchedule(editingSchedule.id, { title })
      toast('已修改日程')
      setEditModalOpen(false)
      setEditingSchedule(null)
      refreshSchedulesForWeek()
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : '修改失败'
      toast(msg)
    }
  }

  const handleConfirmAddSchedule = async () => {
    const name = addFormName.trim()
    if (!name) {
      toast('请填写日程名')
      return
    }
    const d = weekDates[addModalDay]
    if (!d) return
    const hour = 8 + addModalSlot
    const scheduled_at = `${toLocalDateString(d)} ${String(hour).padStart(2, '0')}:00:00`
    const loc = addFormLocation.trim()
    const notes = addFormNotes.trim()
    const title = [name, loc, notes].filter(Boolean).join(' - ')
    try {
      await createSchedule({ title, scheduled_at })
      toast('已添加日程')
      setAddModalOpen(false)
      refreshSchedulesForWeek()
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : '添加失败'
      toast(msg)
    }
  }

  /** 当周的 7 天日期（周一至周日） */
  const weekDates = useMemo(() => {
    const mon = new Date(weekMonday)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon)
      d.setDate(d.getDate() + i)
      return d
    })
  }, [weekMonday])

  const thisWeekDiaryRows = useMemo(() => {
    const monday = getWeekMonday(new Date())
    const today = new Date()
    const end = new Date(today)
    end.setHours(23, 59, 59, 999)
    return journals
      .filter((j) => {
        const d = new Date(`${j.week_start.slice(0, 10)}T00:00:00`)
        return d >= monday && d <= end
      })
      .sort((a, b) => a.week_start.localeCompare(b.week_start))
  }, [journals])

  /** 日程按 (dayIndex 0-6, slotIndex 0-13) 分组；slot 按小时 8-21 映射，用本地日期比较避免晚一天 */
  const scheduleGrid = useMemo(() => {
    const grid: Record<string, Schedule[]> = {}
    dedupeSchedulesForDisplay(schedules)
      .filter((s) => s.status === 'pending')
      .forEach((s) => {
        const dateStr = s.scheduled_at.slice(0, 10)
        const hour = parseInt(s.scheduled_at.slice(11, 13), 10) || 8
        const slotIndex = Math.max(0, Math.min(13, hour - 8))
        const dayIndex = weekDates.findIndex((d) => toLocalDateString(d) === dateStr)
        if (dayIndex >= 0) {
          const key = `${dayIndex}-${slotIndex}`
          if (!grid[key]) grid[key] = []
          grid[key].push(s)
        }
      })
    return grid
  }, [schedules, weekDates])

  const refreshSchedulesForWeek = () => {
    const mon = new Date(weekMonday)
    const sun = new Date(mon)
    sun.setDate(sun.getDate() + 6)
    const start = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')} 00:00:00`
    const end = `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, '0')}-${String(sun.getDate()).padStart(2, '0')} 23:59:59`
    getSchedules({ startDate: start, endDate: end }).then(setSchedules)
  }

  const handleGenerateThisWeekJournal = async () => {
    if (guideStep >= 0 && guideStep !== 2) return
    if (guideStep === 2) setGuideStep(3)
    setWeeklyDiaryOpen(true)
    setWeeklySummaryLoading(true)
    setGeneratingJournal(true)
    try {
      const monday = getWeekMonday(new Date())
      const summary = await generateWeeklySummary(toLocalDateString(monday))
      setWeeklySummary(summary)
      toast('本周周记已生成，已为你整理进窗口')
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : '生成失败'
      toast(msg)
    } finally {
      setGeneratingJournal(false)
      setWeeklySummaryLoading(false)
    }
  }

  const handleOpenChatInsights = async () => {
    setInsightOpen(true)
    setInsightLoading(true)
    setInsightComfort('')
    setInsightSuggestions([])
    setInsightSelected([])
    try {
      const res = await getChatInsights({ lookback_days: 7, max_messages: 800 })
      setInsightComfort(res.comfort)
      const sug = res.schedule_suggestions ?? []
      setInsightSuggestions(sug)
      setInsightSelected(sug.map(() => true))
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : '分析失败'
      toast(msg)
      setInsightOpen(false)
    } finally {
      setInsightLoading(false)
    }
  }

  const handleApplySelectedInsights = async () => {
    const toAdd = insightSuggestions.filter((_, i) => insightSelected[i])
    if (toAdd.length === 0) {
      toast('请至少勾选一条日程')
      return
    }
    try {
      for (const s of toAdd) {
        await createSchedule({
          title: s.note ? `${s.title} — ${s.note}` : s.title,
          scheduled_at: s.scheduled_at,
        })
      }
      toast(`已添加 ${toAdd.length} 条日程`)
      setInsightOpen(false)
      refreshSchedulesForWeek()
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : '添加失败'
      toast(msg)
    }
  }

  const highlightedRect = guideHighlightRect
  const highlightPadding = guideStep === 0 ? 0 : 14

  const handleGuideNext = () => {
    if (guideStep === 0) {
      setGuideStep(1)
      return
    }
    if (guideStep === 1) {
      setGuideStep(2)
      return
    }
    if (guideStep === 2) return
    setGuideStep(-1)
    if (user?.id) window.localStorage.setItem(`newbie-guide-profile-pending:${user.id}`, '0')
  }

  if (!user) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
        <p className="text-gray-500 dark:text-gray-400">请先登录</p>
        <Link to="/login" className="text-primary-600 dark:text-primary-400 hover:underline">去登录</Link>
      </div>
    )
  }

  return (
    <div
      id="profile-scroll-container"
      className={`flex-1 w-full min-w-0 p-4 sm:p-6 transition-opacity duration-500 relative ${
        guideStep >= 0 ? 'overflow-hidden' : 'overflow-y-auto'
      } ${
        pageVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <h1 className="text-xl font-semibold text-gray-800 dark:text-slate-100 mb-6">个人中心</h1>

      {/* 用户信息卡片 */}
      <div className="rounded-xl border border-gray-200 dark:border-zinc-700/60 bg-gray-50 dark:bg-[#1a1a1c] p-4 sm:p-6 space-y-4 mb-8">
        <div className="flex items-center gap-4">
          {user.avatar ? (
            <img src={user.avatar} alt="" className="w-16 h-16 rounded-full object-cover" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
              <User className="w-8 h-8 text-primary-600 dark:text-primary-400" />
            </div>
          )}
          <div>
            <p className="text-lg font-medium text-gray-800 dark:text-slate-100">{user.username}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isStudentIdAccount ? `学号：${user.email}` : user.email}
            </p>
          </div>
        </div>
        {!isStudentIdAccount && (
          <dl className="space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <User className="w-4 h-4 text-gray-400" />
              <div>
                <dt className="text-gray-500 dark:text-gray-400">用户名</dt>
                <dd className="text-gray-800 dark:text-gray-200">{user.username}</dd>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Mail className="w-4 h-4 text-gray-400" />
              <div>
                <dt className="text-gray-500 dark:text-gray-400">邮箱</dt>
                <dd className="text-gray-800 dark:text-gray-200">{user.email}</dd>
              </div>
            </div>
          </dl>
        )}
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-gray-400">加载中...</div>
      ) : (
        <div className="space-y-8">
          {/* 本周日记（由与大模型的对话自动生成） */}
          <section ref={weekDiarySectionRef} className="rounded-xl border border-gray-200 dark:border-zinc-700/60 bg-gray-50 dark:bg-[#1a1a1c] p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <h2 className="flex items-center gap-2 text-lg font-medium text-gray-800 dark:text-slate-100">
                <BookOpen className="w-5 h-5 shrink-0" />
                本周日记
              </h2>
              <button
                ref={generateWeekBtnRef}
                type="button"
                onClick={handleGenerateThisWeekJournal}
                disabled={generatingJournal || (guideStep >= 0 && guideStep !== 2)}
                data-guide="profile-guide-generate"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
              >
                <Sparkles className="w-4 h-4" />
                {generatingJournal ? '生成中…' : '生成本周日记'}
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              根据你与数字人助手在本周内的聊天记录，自动整理心情与一小段日记。
            </p>
            {thisWeekDiaryRows.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">暂无聊天，快和我谈谈心吧！</p>
            ) : (
              <ul className="space-y-3">
                {thisWeekDiaryRows.map((j, idx) => (
                  <li
                    key={`${j.week_start}-${j.id}`}
                    ref={idx === 0 ? firstDiaryItemRef : undefined}
                    className="text-sm p-3 rounded-lg bg-white dark:bg-[#131316] border border-gray-100 dark:border-zinc-700/60"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs text-gray-500 dark:text-gray-400">日期 {j.week_start.slice(0, 10)}</span>
                      <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">{formatDayMoodLabel(j.mood)}</span>
                    </div>
                    <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{j.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => setWeeklyDiaryOpen(true)}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700/60 text-gray-700 dark:text-gray-200 text-sm hover:bg-gray-100 dark:hover:bg-zinc-800/70"
            >
              查看周记
            </button>
          </section>

          {/* 日程表 - 周课表样式 */}
          <section id="schedule-section" className="rounded-xl border border-gray-200 dark:border-zinc-700/60 bg-gray-50 dark:bg-[#1a1a1c] p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="flex items-center gap-2 text-lg font-medium text-gray-800 dark:text-slate-100">
                <Calendar className="w-5 h-5" />
                日程表
              </h2>
              <button
                type="button"
                onClick={handleOpenChatInsights}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700/60 text-gray-700 dark:text-gray-200 text-sm hover:bg-gray-100 dark:hover:bg-zinc-800/70"
              >
                <Sparkles className="w-4 h-4" />
                从对话中提取日程
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <button
                type="button"
                onClick={() => setWeekMonday((prev) => { const d = new Date(prev); d.setDate(d.getDate() - 7); return d })}
                className="p-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-zinc-800/70"
                aria-label="上一周"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setWeekMonday((prev) => { const d = new Date(prev); d.setDate(d.getDate() + 7); return d })}
                className="p-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-zinc-800/70"
                aria-label="下一周"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setWeekMonday(getWeekMonday(new Date()))}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 dark:bg-zinc-200 dark:text-zinc-700 dark:border-zinc-200 dark:hover:bg-zinc-300 transition-colors"
              >
                本周
              </button>
              <span className="text-sm font-medium text-gray-800 dark:text-slate-100">
                {weekDates[0] && weekDates[6] ? `${toLocalDateString(weekDates[0])} ~ ${toLocalDateString(weekDates[6])}` : ''}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-zinc-700/60">
                    <th className="w-14 sm:w-16 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">时间</th>
                    {weekDates.map((d, i) => (
                      <th key={i} className="py-2 text-center text-xs font-medium text-gray-700 dark:text-gray-300">
                        <div>周{WEEKDAYS[i]}</div>
                        <div className="text-gray-500 dark:text-gray-400">{String(d.getMonth() + 1).padStart(2, '0')}/{String(d.getDate()).padStart(2, '0')}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SLOT_LABELS.map((label, slotIndex) => (
                    <tr key={slotIndex} className="border-b border-gray-100 dark:border-slate-800/80 min-h-[56px]">
                      <td className="py-1 text-xs text-gray-500 dark:text-gray-400 align-top w-14 sm:w-16 min-h-[56px]">{label}</td>
                      {weekDates.map((_, dayIndex) => {
                        const key = `${dayIndex}-${slotIndex}`
                        const cellSchedules = scheduleGrid[key] ?? []
                        return (
                          <td key={dayIndex} className="p-0.5 align-top min-w-[80px] min-h-[56px] relative group">
                            <div className="flex flex-col gap-0.5 min-h-[52px]">
                              {cellSchedules.map((s, idx) => (
                                <div
                                  key={s.id}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => openEditModal(s)}
                                  onKeyDown={(e) => e.key === 'Enter' && openEditModal(s)}
                                  className={`relative z-10 rounded px-1.5 py-1.5 text-xs text-white ${EVENT_COLORS[idx % EVENT_COLORS.length]} flex items-center justify-between gap-1 min-h-[52px] cursor-pointer hover:opacity-90 transition-opacity`}
                                >
                                  <span className="truncate flex-1" title={s.title}>{s.title}</span>
                                  <button
                                    type="button"
                                    onClick={async (ev) => {
                                      ev.stopPropagation()
                                      try {
                                        await deleteSchedule(s.id)
                                        refreshSchedulesForWeek()
                                      } catch {
                                        // ignore
                                      }
                                    }}
                                    className="shrink-0 text-white/90 hover:text-white p-0.5"
                                    aria-label="删除"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => openAddModal(dayIndex, slotIndex)}
                                className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded bg-gray-200/80 dark:bg-slate-800/70 hover:bg-gray-300 dark:hover:bg-slate-700/80 text-gray-600 dark:text-gray-300 min-h-[52px]"
                                aria-label="添加日程"
                              >
                                <Plus className="w-6 h-6" />
                              </button>
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 新增日程弹窗 */}
            {addModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setAddModalOpen(false)}>
                <div
                  className="bg-white dark:bg-[#1a1a1c] rounded-xl shadow-xl max-w-sm w-full p-5 border border-gray-200 dark:border-zinc-700/60"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-4">新增日程</h3>
                  {weekDates[addModalDay] && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                      时间：{weekDates[addModalDay].getMonth() + 1}月{weekDates[addModalDay].getDate()}日 {SLOT_LABELS[addModalSlot]} - {String(8 + addModalSlot + 1).padStart(2, '0')}:00
                    </p>
                  )}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">日程名</label>
                      <input
                        type="text"
                        placeholder="请填写日程名"
                        value={addFormName}
                        onChange={(e) => setAddFormName(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700/60 bg-white dark:bg-[#131316] text-gray-800 dark:text-slate-100 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">地点</label>
                      <input
                        type="text"
                        placeholder="请填写地点"
                        value={addFormLocation}
                        onChange={(e) => setAddFormLocation(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700/60 bg-white dark:bg-[#131316] text-gray-800 dark:text-slate-100 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">备注</label>
                      <input
                        type="text"
                        placeholder="请填写日程备注"
                        value={addFormNotes}
                        onChange={(e) => setAddFormNotes(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700/60 bg-white dark:bg-[#131316] text-gray-800 dark:text-slate-100 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-5">
                    <button
                      type="button"
                      onClick={() => setAddModalOpen(false)}
                      className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-zinc-700/60 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-100 dark:hover:bg-zinc-800/70"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmAddSchedule}
                      className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                    >
                      确定
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 编辑日程弹窗 */}
            {editModalOpen && editingSchedule && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => { setEditModalOpen(false); setEditingSchedule(null) }}>
                <div
                  className="bg-white dark:bg-[#1a1a1c] rounded-xl shadow-xl max-w-sm w-full p-5 border border-gray-200 dark:border-zinc-700/60"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-4">修改日程</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                    时间：{editingSchedule.scheduled_at.slice(0, 10)} {editingSchedule.scheduled_at.slice(11, 16)}
                  </p>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">日程名</label>
                      <input
                        type="text"
                        placeholder="请填写日程名"
                        value={editFormName}
                        onChange={(e) => setEditFormName(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700/60 bg-white dark:bg-[#131316] text-gray-800 dark:text-slate-100 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">地点</label>
                      <input
                        type="text"
                        placeholder="请填写地点"
                        value={editFormLocation}
                        onChange={(e) => setEditFormLocation(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700/60 bg-white dark:bg-[#131316] text-gray-800 dark:text-slate-100 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">备注</label>
                      <input
                        type="text"
                        placeholder="请填写日程备注"
                        value={editFormNotes}
                        onChange={(e) => setEditFormNotes(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700/60 bg-white dark:bg-[#131316] text-gray-800 dark:text-slate-100 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-5">
                    <button
                      type="button"
                      onClick={() => { setEditModalOpen(false); setEditingSchedule(null) }}
                      className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-zinc-700/60 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-100 dark:hover:bg-zinc-800/70"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmEditSchedule}
                      className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                    >
                      确定
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {weeklyDiaryOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/55"
          onClick={() => setWeeklyDiaryOpen(false)}
          role="presentation"
        >
          <div
            className="bg-white dark:bg-[#1a1a1c] rounded-xl shadow-xl max-w-2xl w-full p-5 border border-gray-200 dark:border-zinc-700/60 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="weekly-diary-dialog-title"
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 id="weekly-diary-dialog-title" className="text-lg font-semibold text-gray-800 dark:text-slate-100">
                本周周记（小Q的整周总结）
              </h3>
              <button
                type="button"
                onClick={() => setWeeklyDiaryOpen(false)}
                className="px-2.5 py-1 rounded-md text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800/70"
              >
                关闭
              </button>
            </div>
            {(generatingJournal || weeklySummaryLoading) && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">正在为你整理整周周记，请稍候…</p>
            )}
            {weeklySummary ? (
              <div className="text-sm p-4 rounded-lg bg-gray-50 dark:bg-[#131316] border border-gray-200 dark:border-zinc-700/60">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    本周 {weeklySummary.week_start} ~ {weeklySummary.week_end}
                  </span>
                  <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                    {formatDayMoodLabel(weeklySummary.mood)}
                  </span>
                </div>
                <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{weeklySummary.body}</p>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">点击「生成本周日记」后，这里会展示一条整周周记总结。</p>
            )}
          </div>
        </div>
      )}

      {insightOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setInsightOpen(false)}
          role="presentation"
        >
          <div
            className="bg-white dark:bg-[#1a1a1c] rounded-xl shadow-xl max-w-lg w-full p-5 border border-gray-200 dark:border-zinc-700/60 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="insight-dialog-title"
          >
            <h3 id="insight-dialog-title" className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-3">
              日程来源与建议
            </h3>
            {insightLoading ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">正在分析近期对话…</p>
            ) : (
              <>
                <div className="mb-4">
                  <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{insightComfort}</p>
                </div>
                <div className="mb-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">可选日程（勾选后添加到下方日程表）</p>
                  {insightSuggestions.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">未识别到明确时间安排，可多聊几句后再试。</p>
                  ) : (
                    <ul className="space-y-2">
                      {insightSuggestions.map((s, i) => (
                        <li key={`${s.scheduled_at}-${i}`} className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={insightSelected[i] ?? false}
                            onChange={() =>
                              setInsightSelected((prev) => {
                                const next = [...prev]
                                next[i] = !next[i]
                                return next
                              })
                            }
                            className="mt-1 rounded border-gray-300"
                          />
                          <div>
                            <p className="font-medium text-gray-800 dark:text-slate-100">{s.title}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{s.scheduled_at}</p>
                            {s.note && <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{s.note}</p>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setInsightOpen(false)}
                    className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-zinc-700/60 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-100 dark:hover:bg-zinc-800/70"
                  >
                    关闭
                  </button>
                  <button
                    type="button"
                    onClick={handleApplySelectedInsights}
                    disabled={insightSuggestions.length === 0}
                    className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                  >
                    添加选中到日程
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {guideStep >= 0 && highlightedRect && (
        <div className="fixed inset-0 z-[90] pointer-events-none">
          <div className="absolute left-0 top-0 right-0 bg-transparent pointer-events-auto" style={{ height: Math.max(0, highlightedRect.top - 1) }} />
          <div className="absolute left-0 bg-transparent pointer-events-auto" style={{ top: Math.max(0, highlightedRect.top - 1), width: Math.max(0, highlightedRect.left - 1), height: highlightedRect.height + 2 }} />
          <div className="absolute right-0 bg-transparent pointer-events-auto" style={{ top: Math.max(0, highlightedRect.top - 1), width: Math.max(0, window.innerWidth - (highlightedRect.left + highlightedRect.width) - 1), height: highlightedRect.height + 2 }} />
          <div className="absolute left-0 right-0 bottom-0 bg-transparent pointer-events-auto" style={{ top: highlightedRect.top + highlightedRect.height + 1 }} />
          <div
            className={`absolute transition-all duration-700 ease-in-out ${
              guideStep === 0 || guideStep === 1 ? 'rounded-xl' : 'rounded-2xl'
            }`}
            style={{
              left: highlightedRect.left - highlightPadding,
              top: highlightedRect.top - highlightPadding,
              width: highlightedRect.width + highlightPadding * 2,
              height: highlightedRect.height + highlightPadding * 2,
              background: 'transparent',
              boxShadow:
                '0 0 0 9999px rgba(6,10,18,0.30), 0 0 0 1px rgba(255,255,255,0.16), 0 0 22px 8px rgba(147,197,253,0.32), 0 0 44px 18px rgba(147,197,253,0.18)',
            }}
          />
          <div className="absolute left-1/2 -translate-x-1/2 bottom-8 w-[min(92vw,560px)] pointer-events-auto rounded-2xl border border-white/20 bg-white/80 dark:bg-[#1a1a1c]/90 backdrop-blur-xl p-4 shadow-xl">
            <p className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap">
              {guideStep === 0
                ? '这是本周日记窗口：会汇总并展示你本周的情绪与日记记录。'
                : guideStep === 1
                  ? '这里会总结记录当天的情绪事件与心情天气。'
                  : guideStep === 2
                    ? '点击「生成本周日记」，小Q会为你总结这一周的重要事情与情绪变化。'
                    : '这就是本周周记窗口：这里会展示整周总结。'}
            </p>
            {(guideStep === 0 || guideStep === 1 || guideStep === 3) && (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  data-guide="profile-guide-next"
                  onClick={handleGuideNext}
                  className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm hover:bg-primary-700"
                >
                  确定
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
