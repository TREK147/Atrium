import { create } from 'zustand'
import type { ThemeMode, PrimaryColorKey, ThemeState } from '@/utils/theme'
import {
  loadThemeFromStorage,
  saveThemeToStorage,
  applyTheme,
  getResolvedTheme,
  getSystemTheme,
} from '@/utils/theme'

interface ThemeStore extends ThemeState {
  /** 解析后的实际明暗（用于 UI 显示当前是亮/暗） */
  resolvedTheme: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
  setPrimaryColor: (color: PrimaryColorKey) => void
  setTheme: (state: Partial<ThemeState>) => void
  /** 初始化：从 storage 加载并应用，并监听系统主题变化 */
  init: () => () => void
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  mode: 'light',
  primaryColor: 'blue',
  resolvedTheme: 'light',

  setMode: (mode) => {
    const { primaryColor } = get()
    set({ mode, resolvedTheme: getResolvedTheme(mode) })
    saveThemeToStorage({ mode, primaryColor })
    applyTheme(mode, primaryColor)
  },

  setPrimaryColor: (primaryColor) => {
    const state = get()
    set({ primaryColor })
    saveThemeToStorage({ mode: state.mode, primaryColor })
    applyTheme(state.mode, primaryColor)
  },

  setTheme: (patch) => {
    const next = { ...get(), ...patch }
    const resolved = getResolvedTheme(next.mode)
    set({ ...next, resolvedTheme: resolved })
    saveThemeToStorage({ mode: next.mode, primaryColor: next.primaryColor })
    applyTheme(next.mode, next.primaryColor)
  },

  init: () => {
    const saved = loadThemeFromStorage()
    const resolved = getResolvedTheme(saved.mode)
    set({
      mode: saved.mode,
      primaryColor: saved.primaryColor,
      resolvedTheme: resolved,
    })
    applyTheme(saved.mode, saved.primaryColor)

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      const { mode, primaryColor } = get()
      if (mode !== 'system') return
      const resolved = getSystemTheme()
      set({ resolvedTheme: resolved })
      applyTheme('system', primaryColor)
    }
    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  },
}))
