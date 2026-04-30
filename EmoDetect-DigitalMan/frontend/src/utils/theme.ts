/** 持久化 key */
export const THEME_STORAGE_KEY = 'app_theme'

export type ThemeMode = 'light' | 'dark' | 'system'
export type PrimaryColorKey = 'blue' | 'green' | 'purple' | 'orange' | 'rose'

export interface ThemeState {
  mode: ThemeMode
  primaryColor: PrimaryColorKey
}

const PRIMARY_PALETTES: Record<
  PrimaryColorKey,
  { 50: string; 100: string; 400: string; 500: string; 600: string; 700: string; 900: string }
> = {
  blue: { 50: '#f3f6fc', 100: '#e8eef9', 400: '#5d7bb9', 500: '#4768ab', 600: '#3e5d9a', 700: '#334c7f', 900: '#1f2f52' },
  green: { 50: '#f2f8f4', 100: '#e4f1e8', 400: '#4f8f76', 500: '#3f7d66', 600: '#356d58', 700: '#2c5a49', 900: '#1a372d' },
  purple: { 50: '#f6f4fb', 100: '#ede8f8', 400: '#7f67b0', 500: '#6f579f', 600: '#614a8d', 700: '#503d73', 900: '#32254a' },
  orange: { 50: '#fbf6f1', 100: '#f6ecdf', 400: '#b27b4c', 500: '#9d6a3f', 600: '#885b36', 700: '#6f4a2d', 900: '#432c1b' },
  rose: { 50: '#fbf3f5', 100: '#f6e7ec', 400: '#b3687c', 500: '#9f576a', 600: '#8b4a5b', 700: '#733d4c', 900: '#48242f' },
}

export function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 根据 mode 得到实际应用的明暗 */
export function getResolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return getSystemTheme()
  return mode
}

/** 将主题应用到 document：dark class + CSS 变量 */
export function applyTheme(mode: ThemeMode, primaryColor: PrimaryColorKey): void {
  const resolved = getResolvedTheme(mode)
  const root = document.documentElement
  if (resolved === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
  const palette = PRIMARY_PALETTES[primaryColor]
  root.style.setProperty('--primary-50', palette[50])
  root.style.setProperty('--primary-100', palette[100])
  root.style.setProperty('--primary-400', palette[400])
  root.style.setProperty('--primary-500', palette[500])
  root.style.setProperty('--primary-600', palette[600])
  root.style.setProperty('--primary-700', palette[700])
  root.style.setProperty('--primary-900', palette[900])
}

export function loadThemeFromStorage(): ThemeState {
  if (typeof window === 'undefined') {
    return { mode: 'light', primaryColor: 'blue' }
  }
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (!raw) return { mode: 'light', primaryColor: 'blue' }
    const parsed = JSON.parse(raw) as Partial<ThemeState>
    return {
      mode: parsed.mode === 'system' ? 'system' : parsed.mode === 'dark' ? 'dark' : 'light',
      primaryColor:
        parsed.primaryColor && PRIMARY_PALETTES[parsed.primaryColor as PrimaryColorKey]
          ? (parsed.primaryColor as PrimaryColorKey)
          : 'blue',
    }
  } catch {
    return { mode: 'light', primaryColor: 'blue' }
  }
}

export function saveThemeToStorage(state: ThemeState): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

export function getPrimaryPalette(key: PrimaryColorKey) {
  return PRIMARY_PALETTES[key]
}

export const PRIMARY_COLOR_OPTIONS: { key: PrimaryColorKey; label: string }[] = [
  { key: 'blue', label: '蓝色' },
  { key: 'green', label: '绿色' },
  { key: 'purple', label: '紫色' },
  { key: 'orange', label: '橙色' },
  { key: 'rose', label: '玫瑰' },
]
