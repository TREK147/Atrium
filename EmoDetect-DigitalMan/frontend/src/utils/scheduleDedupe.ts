import type { Schedule } from '@/utils/api'

/**
 * 展示层去重：同一天、同一标题、同一「时:分」只保留一条（保留 id 更小的一条），与周历气泡逻辑一致。
 */
export function dedupeSchedulesForDisplay(schedules: readonly Schedule[]): Schedule[] {
  const map = new Map<string, Schedule>()
  for (const s of schedules) {
    const ts = (s.scheduled_at || '').replace('T', ' ').trim()
    const day = ts.slice(0, 10)
    if (day.length < 10) continue
    const titleKey = (s.title || '').trim().replace(/\s+/g, '')
    const hm = ts.length >= 16 ? ts.slice(11, 16) : ''
    const key = `${day}|${titleKey}|${hm}`
    const prev = map.get(key)
    const sid = Number(s.id)
    const pid = prev ? Number(prev.id) : Infinity
    if (!prev || sid < pid) map.set(key, s)
  }
  return [...map.values()]
}
