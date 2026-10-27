import { useEffect, useState } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'dcf-theme'

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* storage blocked */
  }
  return 'system'
}

function apply(pref: ThemePref) {
  const dark =
    pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

/** Light/dark theme: follows prefers-color-scheme unless the user picked one (persisted). */
export function useTheme(): [ThemePref, (p: ThemePref) => void, boolean] {
  const [pref, setPref] = useState<ThemePref>(readPref)
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    apply(pref)
    setIsDark(document.documentElement.classList.contains('dark'))
    try {
      if (pref === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, pref)
    } catch {
      /* ignore */
    }
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => {
      apply('system')
      setIsDark(document.documentElement.classList.contains('dark'))
    }
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [pref])

  return [pref, setPref, isDark]
}
