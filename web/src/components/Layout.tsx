import { NavLink, Outlet } from 'react-router-dom'
import clsx from 'clsx'
import { useRuns } from '../api/hooks'
import { useTheme, type ThemePref } from '../lib/theme'
import { useRunLauncher } from './RunLauncher'

function ThemeToggle() {
  const [pref, setPref, isDark] = useTheme()
  const next: Record<ThemePref, ThemePref> = { system: isDark ? 'light' : 'dark', light: 'dark', dark: 'system' }
  const label = pref === 'system' ? 'Auto' : pref === 'dark' ? 'Dark' : 'Light'
  return (
    <button
      className="btn btn-ghost px-2"
      title={`Theme: ${label} (click to switch${pref === 'dark' ? ' to follow system' : ''})`}
      onClick={() => setPref(next[pref])}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        {isDark ? (
          <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />
        ) : (
          <>
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" />
          </>
        )}
      </svg>
      <span className="text-2xs text-muted">{label}</span>
    </button>
  )
}

const navCls = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
    isActive ? 'bg-sunken text-fg' : 'text-muted hover:text-fg',
  )

export function Layout() {
  const active = useRuns(true)
  const n = active.data?.length ?? 0
  const { open } = useRunLauncher()
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-panel/95 backdrop-blur">
        <div className="flex h-11 items-center gap-4 px-4">
          <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <svg width="18" height="18" viewBox="0 0 32 32">
              <rect width="32" height="32" rx="6" className="fill-fg" />
              <rect x="6" y="7" width="20" height="3" rx="1.5" style={{ fill: 'rgb(var(--src-claude))' }} />
              <rect x="9" y="12.5" width="16" height="3" rx="1.5" style={{ fill: 'rgb(var(--src-codex))' }} />
              <rect x="5" y="18" width="14" height="3" rx="1.5" style={{ fill: 'rgb(var(--src-grok))' }} />
              <rect x="8" y="23.5" width="18" height="3" rx="1.5" style={{ fill: 'rgb(var(--src-agy))' }} />
            </svg>
            <span>DCF Studio</span>
          </NavLink>
          <nav className="flex items-center gap-0.5">
            <NavLink to="/" end className={navCls}>
              Dashboard
            </NavLink>
            <NavLink to="/screener" className={navCls}>
              Screener
            </NavLink>
            <NavLink to="/runs" className={navCls}>
              Runs
              {n > 0 && (
                <span className="num rounded-full bg-accent px-1.5 text-2xs font-semibold leading-4 text-white">{n}</span>
              )}
            </NavLink>
            <NavLink to="/imports" className={navCls}>
              Imports
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            {active.error ? <span className="text-2xs text-neg" title={String(active.error)}>API unreachable</span> : null}
            <ThemeToggle />
            <button className="btn btn-primary" onClick={() => open()}>
              + New run
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 px-4 py-3">
        <Outlet />
      </main>
    </div>
  )
}
