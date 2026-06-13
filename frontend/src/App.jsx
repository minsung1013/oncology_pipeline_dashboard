import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import PipelinePage from './pages/PipelinePage'
import ConferencesPage from './pages/ConferencesPage'

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex flex-col h-screen bg-slate-50">
        {/* Global top bar */}
        <nav className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-1 shrink-0">
          <span className="text-sm font-bold text-slate-700 mr-4">
            Oncology Pipeline Intelligence
          </span>
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `text-sm px-3 py-1.5 rounded font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`
            }
          >
            Pipeline
          </NavLink>
          <NavLink
            to="/conferences"
            className={({ isActive }) =>
              `text-sm px-3 py-1.5 rounded font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`
            }
          >
            Conferences
          </NavLink>
        </nav>

        <div className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<PipelinePage />} />
            <Route path="/conferences" element={<ConferencesPage />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  )
}
