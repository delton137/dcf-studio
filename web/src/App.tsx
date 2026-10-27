import { Link, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { RunLauncherProvider } from './components/RunLauncher'
import { DashboardPage } from './pages/Dashboard'
import { TickerComparePage } from './pages/TickerCompare'
import { VersionPage } from './pages/version/VersionPage'
import { RunsPage } from './pages/Runs'
import { RunDetailPage } from './pages/RunDetail'
import { ImportsPage } from './pages/Imports'
import { ScreenerPage } from './pages/screener/ScreenerPage'

function NotFound() {
  return (
    <div className="py-16 text-center text-sm text-muted">
      Page not found. <Link to="/" className="link">Back to the dashboard</Link>
    </div>
  )
}

export function App() {
  return (
    <RunLauncherProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="screener" element={<ScreenerPage />} />
          <Route path="t/:ticker" element={<TickerComparePage />} />
          <Route path="v/:vid" element={<VersionPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/:vid" element={<RunDetailPage />} />
          <Route path="imports" element={<ImportsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </RunLauncherProvider>
  )
}
