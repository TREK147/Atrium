import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useNavigate } from 'react-router-dom'
import { getEmotionAnomalies, getSchedules, type EmotionAnomaly, type Schedule } from '@/utils/api'
import { dedupeSchedulesForDisplay } from '@/utils/scheduleDedupe'

export default function WeeklyCalendar() {
  const navigate = useNavigate()
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [anomalies, setAnomalies] = useState<EmotionAnomaly[]>([])

  // 生成本周日期 (周一到周日)
  const today = new Date()
  const currentDay = today.getDay() // 0 是周日, 1 是周一
  const diff = today.getDate() - currentDay + (currentDay === 0 ? -6 : 1) // 调整周日的情况
  const monday = new Date(today.setDate(diff))

  const weekDays = Array.from({ length: 7 }).map((_, i) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    return date
  })
  const weekStartKey = `${weekDays[0].getFullYear()}-${String(weekDays[0].getMonth() + 1).padStart(2, '0')}-${String(weekDays[0].getDate()).padStart(2, '0')}`
  const weekEndKey = `${weekDays[6].getFullYear()}-${String(weekDays[6].getMonth() + 1).padStart(2, '0')}-${String(weekDays[6].getDate()).padStart(2, '0')}`

  const dayNames = ['一', '二', '三', '四', '五', '六', '日']

  useEffect(() => {
    const load = async () => {
      const weekStart = new Date(weekDays[0])
      weekStart.setHours(0, 0, 0, 0)
      const weekEnd = new Date(weekDays[6])
      weekEnd.setHours(23, 59, 59, 999)
      const fmt = (d: Date) => {
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        const hh = String(d.getHours()).padStart(2, '0')
        const mm = String(d.getMinutes()).padStart(2, '0')
        const ss = String(d.getSeconds()).padStart(2, '0')
        return `${y}-${m}-${day} ${hh}:${mm}:${ss}`
      }
      try {
        const [sch, emo] = await Promise.all([
          getSchedules({ startDate: fmt(weekStart), endDate: fmt(weekEnd) }),
          getEmotionAnomalies({ limit: 60, since_days: 7 }),
        ])
        setSchedules(sch ?? [])
        setAnomalies(emo ?? [])
      } catch {
        setSchedules([])
        setAnomalies([])
      }
    }
    void load()
  }, [weekStartKey, weekEndKey])

  const parseTimeLabel = (schedule: Schedule): string | null => {
    const ts = (schedule.scheduled_at || '').replace('T', ' ').trim()
    const timePart = ts.split(' ')[1] || ''
    const match = timePart.match(/^(\d{2}):(\d{2})(?::\d{2})?$/)
    if (!match) return null

    const hh = Number(match[1])
    const mm = Number(match[2])
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null

    // 对话抽取的未指明时间会落到默认值（08:00/10:00），视作“无具体时间”
    const isConversationDefaultTime =
      schedule.source === 'conversation' &&
      (timePart.startsWith('08:00') || timePart.startsWith('10:00'))
    if (isConversationDefaultTime) return null

    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }

  const parseApiDateTime = (value?: string | null): number | null => {
    if (!value) return null
    const normalized = value.includes('T') ? value : value.replace(' ', 'T')
    const ts = new Date(normalized).getTime()
    return Number.isFinite(ts) ? ts : null
  }

  const isTaskEnded = (schedule: Schedule, hasSpecificTime: boolean): boolean => {
    const status = (schedule.status || '').toUpperCase()
    if (['DONE', 'COMPLETED', 'FINISHED', 'CLOSED'].includes(status)) return true

    const now = Date.now()
    const endTs = parseApiDateTime(schedule.end_at)
    if (endTs != null) return endTs < now

    const startTs = parseApiDateTime(schedule.scheduled_at)
    if (startTs == null) return false

    // 有明确时间（例如 17:00）时，过开始时间即视为已过期
    if (hasSpecificTime) {
      return startTs < now
    }

    // 无明确时间时，以当天结束作为“过时间”判断边界
    const dayEnd = new Date(startTs)
    dayEnd.setHours(23, 59, 59, 999)
    return dayEnd.getTime() < now
  }

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Array<{ id: number; title: string; timeLabel: string | null; ended: boolean }>>()
    const rows = dedupeSchedulesForDisplay(schedules)
    rows.forEach((s) => {
      const ts = (s.scheduled_at || '').replace('T', ' ')
      const day = ts.slice(0, 10)
      if (!day) return
      const arr = map.get(day) ?? []
      const timeLabel = parseTimeLabel(s)
      arr.push({ id: s.id, title: s.title, timeLabel, ended: isTaskEnded(s, Boolean(timeLabel)) })
      map.set(day, arr)
    })

    map.forEach((tasks, day) => {
      const sorted = [...tasks].sort((a, b) => {
        // 无具体时间的放最前，再按时间升序
        if (!a.timeLabel && b.timeLabel) return -1
        if (a.timeLabel && !b.timeLabel) return 1
        if (!a.timeLabel && !b.timeLabel) return a.id - b.id
        return (a.timeLabel || '').localeCompare(b.timeLabel || '')
      })
      map.set(day, sorted)
    })

    return map
  }, [schedules])

  const moodByDay = useMemo(() => {
    const map = new Map<string, string>()
    const cnt = new Map<string, number>()
    anomalies.forEach((a) => {
      const day = (a.created_at || '').replace('T', ' ').slice(0, 10)
      if (!day) return
      cnt.set(day, (cnt.get(day) ?? 0) + 1)
    })
    weekDays.forEach((d) => {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const c = cnt.get(key) ?? 0
      if (c >= 3) map.set(key, 'bg-violet-200/70 dark:bg-violet-500/30')
      else if (c === 2) map.set(key, 'bg-sky-200/70 dark:bg-sky-500/30')
      else if (c === 1) map.set(key, 'bg-amber-200/70 dark:bg-amber-500/30')
      else map.set(key, '')
    })
    return map
  }, [anomalies, weekDays])

  return (
    <div className="relative z-[70] w-full rounded-xl border border-slate-200/80 bg-white/92 dark:bg-[#1a1a1c] dark:border-zinc-700/60 shadow-[0_8px_24px_rgba(15,23,42,0.06)] p-3 backdrop-blur-sm overflow-visible">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
          <span>📅</span> 本周日程
        </h3>
        <button 
          onClick={() => navigate('/chat/profile#schedule-section')}
          className="text-[10px] text-primary-500 hover:text-primary-600 dark:text-primary-400 transition-colors"
        >
          查看全部
        </button>
      </div>
      
      <div className="flex justify-between items-center">
        {weekDays.map((date, index) => {
          const isToday = new Date().toDateString() === date.toDateString()
          const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
          const dayTasks = tasksByDay.get(dayKey) ?? []
          const hasTask = dayTasks.length > 0
          const moodBg = moodByDay.get(dayKey) ?? ''
          const isNearLeftEdge = index <= 1
          const isNearRightEdge = index >= 5
          const tooltipPositionClass = isNearLeftEdge
            ? 'left-0'
            : isNearRightEdge
              ? 'right-0 translate-x-2'
              : 'left-1/2 -translate-x-1/2'
          const tooltipArrowClass = isNearLeftEdge
            ? 'left-4'
            : isNearRightEdge
              ? 'right-4'
              : 'left-1/2 -translate-x-1/2'

          return (
            <div key={index} className="relative flex flex-col items-center gap-1.5 group group-hover:z-[120]">
              <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">
                {dayNames[index]}
              </span>
              <div
                className={clsx(
                  "relative flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-lg text-xs font-medium cursor-pointer transition-all duration-200",
                  isToday
                    ? "bg-primary-600 text-white shadow-md shadow-primary-700/20 scale-110"
                    : clsx(
                        "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700",
                        moodBg // 渲染情绪热力图背景
                      )
                )}
              >
                {date.getDate()}
                
                {/* 右上角数字角标 */}
                {hasTask && (
                  <span 
                    className={clsx(
                      "absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-bold px-1 rounded-full border border-white dark:border-gray-800 shadow-sm z-10 transition-transform group-hover:scale-110",
                      isToday ? "bg-white text-primary-600 border-primary-500" : "bg-primary-500 text-white"
                    )} 
                  >
                    {dayTasks.length}
                  </span>
                )}
              </div>

              {/* Hover 悬浮提示框：显示当天完整日程（向下展开，避免与数字人区域重叠） */}
              {hasTask && (
                <div className={clsx(
                  'absolute top-full mt-2 w-max max-w-[180px] bg-slate-900/95 dark:bg-gray-100/95 text-slate-100 dark:text-gray-800 text-xs rounded-lg py-2 px-3 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 shadow-xl backdrop-blur-sm',
                  tooltipPositionClass
                )} style={{ zIndex: 999999 }}>
                  <div className="font-medium mb-1.5 border-b border-gray-600/50 dark:border-gray-300/50 pb-1 flex items-center justify-between">
                    <span>{date.getMonth() + 1}月{date.getDate()}日 日程</span>
                    <span className="text-[10px] bg-white/20 dark:bg-slate-700/50 px-1.5 rounded-full ml-2">{dayTasks.length}</span>
                  </div>
                  <ul className="text-[10px] space-y-1 text-left relative z-10">
                    {dayTasks.map(t => (
                      <li
                        key={t.id}
                        className={clsx(
                          'truncate flex items-center gap-1.5',
                          t.ended && 'line-through decoration-white/70 dark:decoration-gray-500 opacity-75',
                        )}
                      >
                        <span className="w-1 h-1 rounded-full bg-primary-400 shrink-0" />
                        {t.title}
                        {t.timeLabel ? ` - ${t.timeLabel}` : ''}
                      </li>
                    ))}
                  </ul>
                  {/* 顶部小箭头 */}
                  <div className={clsx(
                    'absolute bottom-full border-4 border-transparent border-b-slate-900/95 dark:border-b-gray-100/95',
                    tooltipArrowClass
                  )}></div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 情绪热力图图例 (情绪温度计) */}
      <div className="mt-3 pt-2 border-t border-slate-100 dark:border-gray-700/50 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1 shrink-0">
          <span className="flex items-center justify-center w-3 h-3 rounded-full bg-primary-500 text-white text-[8px] font-bold">1</span>
          <span className="text-[9px] text-gray-500 dark:text-gray-400">日程</span>
        </div>
        
        <div className="flex items-center gap-1 flex-1 justify-end">
          <span className="text-[9px] text-gray-500 dark:text-gray-400">低落</span>
          <div className="flex gap-0.5">
            <span className="w-2 h-2 rounded-sm bg-violet-300/80"></span>
            <span className="w-2 h-2 rounded-sm bg-sky-300/80"></span>
            <span className="w-2 h-2 rounded-sm bg-gray-200 dark:bg-gray-700"></span>
            <span className="w-2 h-2 rounded-sm bg-amber-300/80"></span>
            <span className="w-2 h-2 rounded-sm bg-rose-300/80"></span>
          </div>
          <span className="text-[9px] text-gray-500 dark:text-gray-400">开心</span>
        </div>
      </div>
    </div>
  )
}