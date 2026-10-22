import { useEffect } from 'react'

interface Shortcuts {
  onNew?: () => void          // N — open create sheet
  onBack?: () => void         // Escape — close overlay / go back
  onSearch?: () => void       // / — focus search bar
  onToggleTheme?: () => void  // D — toggle dark mode
}

/**
 * Register app-wide keyboard shortcuts.
 * Shortcuts are suppressed when focus is inside an input, textarea, or select.
 */
export function useKeyboardShortcuts({ onNew, onBack, onSearch, onToggleTheme }: Shortcuts) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName.toLowerCase()
      const inInput = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target as HTMLElement).isContentEditable
      if (inInput) return

      switch (e.key) {
        case 'n':
        case 'N':
          if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); onNew?.() }
          break
        case 'Escape':
          onBack?.()
          break
        case '/':
          e.preventDefault()
          onSearch?.()
          break
        case 'd':
        case 'D':
          if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); onToggleTheme?.() }
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onNew, onBack, onSearch, onToggleTheme])
}
