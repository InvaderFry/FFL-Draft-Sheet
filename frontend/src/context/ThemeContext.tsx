import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { THEME_POS_COLORS } from '../utils/posColors'

interface ThemeContextValue {
  theme: string
  setTheme: (value: string) => void
  posColors: Record<string, string>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'ffl_theme'
const VALID_THEMES = ['mocha', 'latte']

function readSavedTheme(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved && VALID_THEMES.includes(saved) ? saved : 'mocha'
  } catch {
    return 'mocha'
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState(readSavedTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // localStorage unavailable (sandboxed iframe, SSR, etc.) — silently ignore
    }
  }, [theme])

  function setTheme(value: string) {
    if (VALID_THEMES.includes(value)) setThemeState(value)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, posColors: THEME_POS_COLORS[theme] }}>
      {children}
    </ThemeContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  // Always rendered within ThemeProvider; cast keeps consumers null-free.
  return useContext(ThemeContext) as ThemeContextValue
}
