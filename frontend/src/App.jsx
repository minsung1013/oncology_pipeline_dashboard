import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Link, Outlet } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import PipelinePage from './pages/PipelinePage'
import ConferencesPage from './pages/ConferencesPage'
import { prefetchPipeline, prefetchAbstracts } from './utils/dataSource'

// recharts가 무거워 시각화 탭은 코드 분할(방문 시에만 로드)
const VisualizePage = lazy(() => import('./pages/VisualizePage'))
const ConferenceVisualizePage = lazy(() => import('./pages/ConferenceVisualizePage'))

const navClass = ({ isActive }) =>
  `text-sm px-3 py-1.5 rounded font-medium transition-colors ${
    isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
  }`

// 대시보드 공통 레이아웃 (상단 네비 + 페이지). 랜딩(/)에는 적용 안 함.
function DashboardLayout() {
  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-1 shrink-0">
        <Link to="/" className="text-sm font-bold text-slate-700 mr-4 hover:opacity-80" title="Home">
          <span className="text-blue-600">Onco</span>lyzer
        </Link>
        {/* Conference 쌍 (hover 시 초록 데이터 프리페치) */}
        <NavLink to="/conferences" className={navClass} onMouseEnter={prefetchAbstracts}>Conferences</NavLink>
        <NavLink to="/conference-visualize" className={navClass} onMouseEnter={prefetchAbstracts}>Conference Visualize</NavLink>
        <span className="w-px h-5 bg-slate-200 mx-2" aria-hidden="true" />
        {/* Pipeline 쌍 (hover 시 파이프라인 프리페치; Visualize는 둘 다 사용) */}
        <NavLink to="/pipeline" className={navClass} onMouseEnter={prefetchPipeline}>Pipeline</NavLink>
        <NavLink to="/visualize" className={navClass} onMouseEnter={() => { prefetchPipeline(); prefetchAbstracts() }}>Pipeline Visualize</NavLink>
      </nav>
      <div className="flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">
              Loading…
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route element={<DashboardLayout />}>
          <Route path="/conferences" element={<ConferencesPage />} />
          <Route path="/conference-visualize" element={<ConferenceVisualizePage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/visualize" element={<VisualizePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
