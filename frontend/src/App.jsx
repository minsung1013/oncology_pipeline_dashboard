import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import PipelinePage from './pages/PipelinePage'
import ConferencesPage from './pages/ConferencesPage'

// recharts가 무거워 Visualize 탭은 코드 분할(방문 시에만 로드)
const VisualizePage = lazy(() => import('./pages/VisualizePage'))

const navClass = ({ isActive }) =>
  `text-sm px-3 py-1.5 rounded font-medium transition-colors ${
    isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
  }`

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex flex-col h-screen bg-slate-50">
        {/* Global top bar */}
        <nav className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-1 shrink-0">
          <span className="text-sm font-bold text-slate-700 mr-4">
            Oncology Pipeline Intelligence
          </span>
          <NavLink to="/" end className={navClass}>
            Pipeline
          </NavLink>
          <NavLink to="/conferences" className={navClass}>
            Conferences
          </NavLink>
          <NavLink to="/visualize" className={navClass}>
            Visualize
          </NavLink>
        </nav>

        <div className="flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                Loading…
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<PipelinePage />} />
              <Route path="/conferences" element={<ConferencesPage />} />
              <Route path="/visualize" element={<VisualizePage />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </BrowserRouter>
  )
}
