import { useState, useEffect } from 'react'

type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'escrow-theme'

function getSystemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark' || (theme === 'system' && getSystemDark())) {
    root.setAttribute('data-theme', 'dark')
  } else {
    root.setAttribute('data-theme', 'light')
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system'
  })

  // Apply on mount and whenever theme changes
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // Track system preference changes when theme === 'system'
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  const setTheme = (next: Theme) => {
    setThemeState(next)
    localStorage.setItem(STORAGE_KEY, next)
  }

  const toggle = () => {
    // Determine current effective mode to know which direction to flip
    const root = document.documentElement
    const isDark = root.getAttribute('data-theme') === 'dark'
    setTheme(isDark ? 'light' : 'dark')
  }

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && typeof window !== 'undefined' && getSystemDark())

  return { theme, isDark, toggle, setTheme }
}
