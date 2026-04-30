import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { getAssistantNoticeCards, type AssistantNoticeCard } from '@/utils/api'

type NoticeItem = {
  id: string
  type: string
  icon: string
  priority: number
  title: string
  subtitle: string
  content: string
  newsItems?: Array<{ title: string; link?: string }>
  newsInterests?: string[]
  newsCachedAt?: number
}

const DISMISSED_STORAGE_KEY = 'assistant_notice_dismissed_ids_v1'

const readDismissedIdsFromStorage = (): Set<string> => {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(DISMISSED_STORAGE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x) => typeof x === 'string' && x.trim()))
  } catch {
    return new Set()
  }
}

const writeDismissedIdsToStorage = (ids: Set<string>) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(Array.from(ids)))
  } catch {
    // ignore write failure
  }
}

const FALLBACK_ITEMS: NoticeItem[] = [
  { id: 'task', type: 'schedule', icon: '📌', priority: 90, title: '高优先级任务', subtitle: '默认提示', content: '今天 14:30 组会准备，建议 13:50 开始材料自检。' },
  { id: 'weather', type: 'weather', icon: '🌤️', priority: 60, title: '天气卡片', subtitle: '默认提示', content: '今日合肥晴，体感舒适，适合安排户外放松。' },
  {
    id: 'interest_news',
    type: 'interest',
    icon: '📰',
    priority: 50,
    title: '兴趣相关新闻',
    subtitle: '你最近兴趣：摄影、骑行、航拍（示例）',
    content: '点击本卡片，我会在下方聊天框里结合网上与兴趣相关的新闻为你做简报。',
  },
]

type AssistantNoticeBarProps = {
  /** 点击「兴趣相关新闻」卡片时：拉取网络标题并在主聊天区触发模型回复 */
  onInterestNewsClick?: (item: NoticeItem) => void | Promise<void>
  /** 关闭「兴趣相关新闻」卡片时：用于后端计次，避免同时间窗再次出现 */
  onInterestNewsDismiss?: (item: NoticeItem) => void | Promise<void>
  /** 与聊天发送中等状态联动，避免重复点击 */
  interestNewsBusy?: boolean
}

export default function AssistantNoticeBar({ onInterestNewsClick, onInterestNewsDismiss, interestNewsBusy }: AssistantNoticeBarProps) {
  const [items, setItems] = useState<NoticeItem[]>(() => {
    const dismissed = readDismissedIdsFromStorage()
    return FALLBACK_ITEMS.filter((item) => !dismissed.has(item.id))
  })
  const [expanded, setExpanded] = useState(false)
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set())
  const cardRefs = useRef<Array<HTMLElement | null>>([])
  const [expandedOffsets, setExpandedOffsets] = useState<number[]>([])
  const [expandedHeight, setExpandedHeight] = useState(480)
  const dismissedIdsRef = useRef<Set<string>>(readDismissedIdsFromStorage())
  const dismissTimersRef = useRef<Record<string, number>>({})

  const handleDismiss = (e: React.MouseEvent | React.KeyboardEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    const targetItem = items.find((item) => item.id === id)
    const prevTimer = dismissTimersRef.current[id]
    if (prevTimer) window.clearTimeout(prevTimer)
    dismissedIdsRef.current.add(id)
    writeDismissedIdsToStorage(dismissedIdsRef.current)
    if (targetItem?.type === 'interest') {
      void onInterestNewsDismiss?.(targetItem)
    }
    setDismissingIds((prev) => new Set(prev).add(id))
    dismissTimersRef.current[id] = window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id))
      setDismissingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      delete dismissTimersRef.current[id]
    }, 280)
  }

  const iconByType = useMemo(
    () =>
      ({
        weather: '🌤️',
        schedule: '📌',
        mood: '🫶',
        interest: '📰',
      } as Record<string, string>),
    []
  )

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const cards = await getAssistantNoticeCards()
        if (!alive || !cards.length) return
        const mapped: NoticeItem[] = cards
          .filter((c: AssistantNoticeCard) => !dismissedIdsRef.current.has(c.id))
          .map((c: AssistantNoticeCard) => ({
          id: c.id,
          type: c.type || '',
          icon: iconByType[c.type] ?? '💡',
          priority: Number(c.priority ?? 0),
          title: c.title,
          subtitle: c.subtitle || '',
          content: c.content || '',
          newsItems: c.news_items ?? [],
          newsInterests: c.news_interests ?? [],
          newsCachedAt: c.news_cached_at,
        }))
        mapped.sort((a, b) => b.priority - a.priority)
        setItems(mapped)
      } catch {
        // keep fallback items
      }
    }
    void load()
    const timer = window.setInterval(load, 30000)
    return () => {
      alive = false
      window.clearInterval(timer)
      Object.values(dismissTimersRef.current).forEach((t) => window.clearTimeout(t))
      dismissTimersRef.current = {}
    }
  }, [iconByType])

  useLayoutEffect(() => {
    if (!items.length) return
    const offsets: number[] = []
    let acc = 0
    for (let i = 0; i < items.length; i++) {
      offsets[i] = acc
      const h = cardRefs.current[i]?.offsetHeight ?? 118
      acc += h
    }
    setExpandedOffsets(offsets)
    setExpandedHeight(Math.max(120, acc))
  }, [items, expanded])

  return (
    <div
      className={`relative w-[252px] pointer-events-auto transition-[height] duration-300 ease-out ${
        expanded ? '' : 'h-[120px]'
      }`}
      style={expanded ? { height: `${expandedHeight}px` } : undefined}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="absolute inset-0">
        {items.map((item, idx) => {
          const z = items.length - idx
          const collapsedY = idx * 10
          const expandedY = idx * 118
          const x = idx * 3
          const scale = 1 - idx * 0.015
          const isInterestCard = item.type === 'interest'
          const interestClickable = Boolean(isInterestCard && onInterestNewsClick)
          const isDismissing = dismissingIds.has(item.id)
          return (
            <article
              key={item.id}
              tabIndex={interestClickable ? 0 : undefined}
              role={interestClickable ? 'button' : undefined}
              aria-busy={interestClickable ? interestNewsBusy : undefined}
              onClick={
                interestClickable
                  ? (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (interestNewsBusy) return
                      handleDismiss(e, item.id)
                      void onInterestNewsClick?.(item)
                    }
                  : undefined
              }
              onKeyDown={
                interestClickable
                  ? (e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault()
                      e.stopPropagation()
                      if (interestNewsBusy) return
                      handleDismiss(e, item.id)
                      void onInterestNewsClick?.(item)
                    }
                  : undefined
              }
              className={`absolute left-0 top-0 w-[240px] rounded-xl border border-zinc-200/90 bg-white/95 shadow-[0_10px_26px_rgba(24,24,27,0.12)] backdrop-blur-md px-3.5 py-2.5 transition-all duration-300 ease-out will-change-transform dark:border-zinc-700/70 dark:bg-[#1a1a1c] dark:shadow-[0_14px_36px_rgba(0,0,0,0.52),0_0_0_1px_rgba(161,161,170,0.10)] dark:ring-1 dark:ring-inset dark:ring-white/[0.04] dark:backdrop-blur-sm${
                interestClickable ? ' cursor-pointer' : ''
              }${interestClickable && interestNewsBusy ? ' opacity-60 pointer-events-none' : ''}`}
              ref={(el) => {
                cardRefs.current[idx] = el
              }}
              style={{
                zIndex: expanded ? 100 - idx : z,
                transitionDelay: expanded ? `${idx * 12}ms` : '0ms',
                transform: isDismissing
                  ? `translate(0px, ${(expandedOffsets[idx] ?? expandedY) + 8}px) scale(0.86)`
                  : expanded
                    ? `translate(0px, ${expandedOffsets[idx] ?? expandedY}px) scale(1)`
                    : `translate(${x}px, ${collapsedY}px) scale(${scale})`,
                opacity: isDismissing ? 0 : (expanded ? 1 : idx > 2 ? 0 : 1),
              }}
            >
              <div className="flex items-center gap-1.5 pr-5">
                <span className="text-sm">{item.icon}</span>
                <p className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">{item.title}</p>
              </div>
              <button
                type="button"
                className={`absolute top-2 right-2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800/70 transition-colors ${expanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={(e) => handleDismiss(e, item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    handleDismiss(e, item.id)
                  }
                }}
                aria-label="关闭卡片"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              {item.subtitle ? (
                <p className="mt-0.5 truncate text-[10px] text-zinc-600 dark:text-zinc-400">{item.subtitle}</p>
              ) : null}
              <p className={`mt-1 text-[11px] leading-relaxed whitespace-pre-line text-zinc-700 dark:text-zinc-100/90 ${expanded ? 'line-clamp-none' : 'line-clamp-1'}`}>
                {item.content}
              </p>
            </article>
          )
        })}
      </div>
    </div>
  )
}
