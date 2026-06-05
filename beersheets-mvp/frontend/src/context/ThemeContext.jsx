import { createContext, useContext, useState, useEffect } from 'react'
import { THEME_POS_COLORS } from '../utils/posColors'

const ThemeContext = createContext(null)

const STORAGE_KEY = 'ffl_theme'
const VALID_THEMES = ['dark', 'macchiato', 'latte']

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return VALID_THEMES.includes(saved) ? saved : 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState, posColors: THEME_POS_COLORS[theme] }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
