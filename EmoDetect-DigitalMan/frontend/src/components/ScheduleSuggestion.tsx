import { useEffect, useMemo, useState } from 'react'
import { getSchedules, updateSchedule, type Schedule } from '@/utils/api'
import { useToastStore } from '@/stores/useToastStore'

function parseApiDateTime(value?: string | null): Date | null {
  if (!value) return null
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const d = new Date(normalized)
  return Number.isFinite(d.getTime()) ? d : null
}

function isDoneStatus(status?: string): boolean {
  const upper = (status || '').toUpperCase()
  return ['DONE', 'COMPLETED', 'FINISHED', 'CLOSED'].includes(upper)
}

function formatScheduleWhen(value?: string | null): string {
  const d = parseApiDateTime(value)
  if (!d) return '即将'
  const now = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dayDiff = Math.floor((startOf(d) - startOf(now)) / (24 * 60 * 60 * 1000))
  const dayText = dayDiff === 0 ? '今天' : dayDiff === 1 ? '明天' : dayDiff === 2 ? '后天' : `${d.getMonth() + 1}月${d.getDate()}日`
  const h = d.getHours()
  const m = d.getMinutes()
  const period = h < 6 ? '凌晨' : h < 12 ? '上午' : h < 14 ? '中午' : h < 19 ? '下午' : '晚上'
  const displayHour = h % 12 === 0 ? 12 : h % 12
  const minuteText = m === 0 ? '' : `${m}分`
  return `${dayText}${period}${displayHour}点${minuteText}`
}

function fmtApiDateTime(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')} ${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:${String(value.getSeconds()).padStart(2, '0')}`
}

function normalizeMinuteKey(value?: string | null): string {
  const d = parseApiDateTime(value)
  if (!d) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function normalizeTitleKey(value?: string | null): string {
  return (value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[，。！？；、,.!?;:：]+$/g, '')
}

export default function ScheduleSuggestion() {
  const toast = useToastStore((s) => s.show)
  const [loading, setLoading] = useState(true)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [dismissedReminderIds, setDismissedReminderIds] = useState<Set<number>>(new Set())
  const [dismissedConflictKeys, setDismissedConflictKeys] = useState<Set<string>>(new Set())
  const [applyingConflict, setApplyingConflict] = useState(false)

  useEffect(() => {
    let alive = true
    const loadSchedules = async () => {
      try {
        const now = new Date()
        const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        const rows = await getSchedules({ startDate: fmtApiDateTime(now), endDate: fmtApiDateTime(end) })
        if (!alive) return
        setSchedules(rows ?? [])
      } catch {
        if (!alive) return
        setSchedules([])
      } finally {
        if (alive) setLoading(false)
      }
    }
    void loadSchedules()
    const timer = window.setInterval(() => {
      void loadSchedules()
    }, 20_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  const upcoming = useMemo(() => {
    const nowTs = Date.now()
    const dedup = new Map<string, { row: Schedule; ts: number }>()

    for (const s of schedules) {
      if (isDoneStatus(s.status)) continue
      const ts = parseApiDateTime(s.scheduled_at)?.getTime() ?? Number.POSITIVE_INFINITY
      if (!Number.isFinite(ts) || ts < nowTs) continue

      // 同一分钟 + 同标题视为同一事项，避免重复出现
      const key = `${normalizeMinuteKey(s.scheduled_at)}__${normalizeTitleKey(s.title)}`
      const prev = dedup.get(key)
      if (!prev || s.id < prev.row.id) {
        dedup.set(key, { row: s, ts })
      }
    }

    return Array.from(dedup.values())
  }, [schedules])

  const reminderSchedule = useMemo(() => {
    const now = Date.now()
    const inReminderWindow = upcoming
      .filter((x) => !dismissedReminderIds.has(x.row.id))
      .filter((x) => {
        const diff = x.ts - now
        return diff >= 0 && diff <= 30 * 60 * 1000
      })
      .sort((a, b) => b.ts - a.ts) // 后一个到提醒窗口时，顶掉前一个
    return inReminderWindow[0]?.row ?? null
  }, [upcoming, dismissedReminderIds])

  const conflictSuggestion = useMemo(() => {
    const byMinute = new Map<string, Schedule[]>()
    for (const x of upcoming) {
      const key = normalizeMinuteKey(x.row.scheduled_at)
      if (!key) continue
      const arr = byMinute.get(key) ?? []
      arr.push(x.row)
      byMinute.set(key, arr)
    }
    const candidates = Array.from(byMinute.entries())
      .filter(([, arr]) => arr.length >= 2)
      .filter(([key]) => !dismissedConflictKeys.has(key))
      .sort((a, b) => {
        if (b[1].length !== a[1].length) return b[1].length - a[1].length
        return a[0].localeCompare(b[0])
      })
    if (!candidates.length) return null
    const [timeKey, rows] = candidates[0]
    const recommended = [...rows].sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    return { timeKey, rows: recommended }
  }, [upcoming, dismissedConflictKeys])

  const mode: 'reminder' | 'suggestion' | null = reminderSchedule
    ? 'reminder'
    : conflictSuggestion
      ? 'suggestion'
      : null

  const title = mode === 'reminder' ? '日程提醒' : mode === 'suggestion' ? '智能日程建议' : ''
  const icon = mode === 'reminder' ? '⏰' : mode === 'suggestion' ? '💡' : ''
  const content = useMemo(() => {
    if (mode === 'reminder' && reminderSchedule) {
      return `${formatScheduleWhen(reminderSchedule.scheduled_at)}开始「${reminderSchedule.title}」，请提前准备。`
    }
    if (mode === 'suggestion' && conflictSuggestion) {
      const names = conflictSuggestion.rows.map((x) => `「${x.title}」`).join('、')
      return `检测到 ${conflictSuggestion.timeKey} 有 ${conflictSuggestion.rows.length} 个冲突日程：${names}。我可以为你自动排执行先后。`
    }
    return ''
  }, [mode, reminderSchedule, conflictSuggestion])

  if (loading || !mode) {
    return null
  }

  const handleConfirmReminder = () => {
    if (!reminderSchedule) return
    setDismissedReminderIds((prev) => {
      const next = new Set(prev)
      next.add(reminderSchedule.id)
      return next
    })
  }

  const handleApplyConflict = async () => {
    if (!conflictSuggestion || applyingConflict) return
    const base = parseApiDateTime(`${conflictSuggestion.timeKey}:00`)
    if (!base) {
      toast('时间解析失败，请稍后重试')
      return
    }
    setApplyingConflict(true)
    try {
      const intervalMin = 30
      for (let i = 0; i < conflictSuggestion.rows.length; i++) {
        const schedule = conflictSuggestion.rows[i]
        const nextAt = new Date(base.getTime() + i * intervalMin * 60 * 1000)
        await updateSchedule(schedule.id, { scheduled_at: fmtApiDateTime(nextAt) })
      }
      toast(`已按推荐顺序为你错峰安排 ${conflictSuggestion.rows.length} 条日程`)
      setDismissedConflictKeys((prev) => {
        const next = new Set(prev)
        next.add(conflictSuggestion.timeKey)
        return next
      })
      const now = new Date()
      const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      const rows = await getSchedules({ startDate: fmtApiDateTime(now), endDate: fmtApiDateTime(end) })
      setSchedules(rows ?? [])
    } catch {
      toast('自动排程失败，请稍后重试')
    } finally {
      setApplyingConflict(false)
    }
  }

  const handleDismissConflict = () => {
    if (!conflictSuggestion) return
    setDismissedConflictKeys((prev) => {
      const next = new Set(prev)
      next.add(conflictSuggestion.timeKey)
      return next
    })
  }

  return (
    <div className="w-full rounded-xl border border-slate-200/80 dark:border-zinc-700/60 bg-gradient-to-br from-white to-slate-50/80 dark:from-[#1a1a1c] dark:to-[#131316] shadow-[0_8px_24px_rgba(15,23,42,0.06)] p-3 backdrop-blur-sm relative overflow-hidden">
      {/* 装饰性背景光晕 */}
      <div className="absolute -top-6 -right-6 w-16 h-16 bg-primary-500/15 dark:bg-primary-500/12 blur-xl rounded-full pointer-events-none" />
      
      <div className="flex items-center gap-1.5 mb-2 relative z-10">
        <span className="text-primary-500 dark:text-blue-400 animate-pulse text-xs">{icon}</span>
        <h3 className="text-xs font-semibold text-slate-800 dark:text-blue-100 tracking-wide">
          {title}
        </h3>
      </div>
      
      <div className="relative z-10">
        <p className="text-[11px] text-slate-700 dark:text-blue-200/85 leading-relaxed mb-2.5 line-clamp-3 hover:line-clamp-none transition-all">
          {content}
        </p>

        {mode === 'reminder' ? (
          <div className="flex">
            <button
              type="button"
              onClick={handleConfirmReminder}
              className="w-full bg-primary-600 hover:bg-primary-700 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-[10px] py-1 rounded-lg transition-colors font-medium shadow-sm shadow-primary-700/20 active:scale-95"
            >
              好的
            </button>
          </div>
        ) : conflictSuggestion ? (
          <div className="space-y-2">
            <ol className="text-[10px] text-slate-700 dark:text-blue-200/80 list-decimal pl-4">
              {conflictSuggestion.rows.map((s) => (
                <li key={s.id} className="truncate">{s.title}</li>
              ))}
            </ol>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => void handleApplyConflict()}
                disabled={applyingConflict}
                className="flex-1 bg-primary-600 hover:bg-primary-700 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-[10px] py-1 rounded-lg transition-colors font-medium shadow-sm shadow-primary-700/20 active:scale-95 disabled:opacity-60"
              >
                {applyingConflict ? '安排中...' : '按推荐安排'}
              </button>
              <button
                type="button"
                onClick={handleDismissConflict}
                disabled={applyingConflict}
                className="flex-1 bg-white/70 hover:bg-white dark:bg-gray-800/60 dark:hover:bg-gray-700/80 text-slate-700 dark:text-blue-300 text-[10px] py-1 rounded-lg transition-colors border border-slate-200 dark:border-blue-700/50 active:scale-95 disabled:opacity-60"
              >
                稍后再说
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
