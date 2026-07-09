import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Link, Outlet } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import PipelinePage from './pages/PipelinePage'
import ConferencesPage from './pages/ConferencesPage'
import PublicationsPage from './pages/PublicationsPage'
import { prefetchPipeline, prefetchAbstracts, prefetchPublications } from './utils/dataSource'

// recharts가 무거워 시각화 탭은 코드 분할(방문 시에만 로드)
const VisualizePage = lazy(() => import('./pages/VisualizePage'))
const ConferenceVisualizePage = lazy(() => import('./pages/ConferenceVisualizePage'))
const PublicationVisualizePage = lazy(() => import('./pages/PublicationVisualizePage'))
const TargetMaturityPage = lazy(() => import('./pages/TargetMaturityPage'))
const OpportunityMapPage = lazy(() => import('./pages/OpportunityMapPage'))
const BiomarkerMaturityPage = lazy(() => import('./pages/BiomarkerMaturityPage'))
const BiomarkerOpportunityPage = lazy(() => import('./pages/BiomarkerOpportunityPage'))

const navClass = ({ isActive }) =>
  `shrink-0 whitespace-nowrap text-sm px-2.5 sm:px-3 py-1.5 rounded font-medium transition-colors ${
    isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
  }`

// 메뉴 구역: 라벨 + 소속 링크들을 묶어 표시
function NavSection({ label, children }) {
  return (
    <div className="shrink-0 flex items-center gap-0.5">
      <span className="shrink-0 text-[10px] font-semibold text-slate-400 uppercase tracking-wide mr-0.5">{label}</span>
      {children}
    </div>
  )
}
const navDivider = <span className="shrink-0 w-px h-5 bg-slate-200 mx-1.5 sm:mx-2.5" aria-hidden="true" />

// 대시보드 공통 레이아웃 (상단 네비 + 페이지). 랜딩(/)에는 적용 안 함.
function DashboardLayout() {
  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-3 sm:px-4 py-2 flex items-center gap-1 shrink-0 overflow-x-auto">
        <Link to="/" className="shrink-0 text-sm font-bold text-slate-700 mr-2 sm:mr-3 hover:opacity-80" title="Home">
          <span className="text-blue-600">Onco</span>lyzer
        </Link>
        <NavSection label="Conference">
          <NavLink to="/conferences" className={navClass} onMouseEnter={prefetchAbstracts}>List</NavLink>
          <NavLink to="/conference-visualize" className={navClass} onMouseEnter={prefetchAbstracts}>Visualize</NavLink>
        </NavSection>
        {navDivider}
        <NavSection label="Publication">
          <NavLink to="/publications" className={navClass} onMouseEnter={prefetchPublications}>List</NavLink>
          <NavLink to="/publication-visualize" className={navClass} onMouseEnter={prefetchPublications}>Visualize</NavLink>
        </NavSection>
        {navDivider}
        <NavSection label="Clinical Trial">
          <NavLink to="/pipeline" className={navClass} onMouseEnter={prefetchPipeline}>List</NavLink>
          <NavLink to="/visualize" className={navClass} onMouseEnter={() => { prefetchPipeline(); prefetchAbstracts() }}>Visualize</NavLink>
        </NavSection>
        {navDivider}
        <NavSection label="Target">
          <NavLink to="/maturity" className={navClass} onMouseEnter={() => { prefetchPipeline(); prefetchAbstracts() }}>Maturity</NavLink>
          <NavLink to="/opportunity" className={navClass} onMouseEnter={() => { prefetchPipeline(); prefetchAbstracts() }}>Opportunity</NavLink>
        </NavSection>
        {navDivider}
        <NavSection label="Biomarker">
          <NavLink to="/biomarker-maturity" className={navClass} onMouseEnter={() => { prefetchPipeline(); prefetchAbstracts() }}>Maturity</NavLink>
          <NavLink to="/biomarker-opportunity" className={navClass} onMouseEnter={() => { prefetchPipeline(); prefetchAbstracts() }}>Opportunity</NavLink>
        </NavSection>
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
          <Route path="/publications" element={<PublicationsPage />} />
          <Route path="/publication-visualize" element={<PublicationVisualizePage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/visualize" element={<VisualizePage />} />
          <Route path="/maturity" element={<TargetMaturityPage />} />
          <Route path="/opportunity" element={<OpportunityMapPage />} />
          <Route path="/biomarker-maturity" element={<BiomarkerMaturityPage />} />
          <Route path="/biomarker-opportunity" element={<BiomarkerOpportunityPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
