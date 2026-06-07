import { useState, useEffect, useMemo } from 'react'
import FilterBar from './components/FilterBar'
import CompanyList from './components/CompanyList'
import PipelineTable from './components/PipelineTable'
import { applyFilters, getFilterOptions, groupByCompany } from './utils/filters'

// 로컬: public/pipeline.json (fallback)
// 배포: GitHub raw에서 직접 fetch (Cloudflare 25MB 파일 제한 우회)
const PIPELINE_URL =
  import.meta.env.VITE_PIPELINE_URL ??
  'https://raw.githubusercontent.com/minsung1013/oncology_pipeline_dashboard/main/data/parsed/pipeline.json'

const DEFAULT_FILTERS = {
  cancerCategories: [],
  modalities: [],
  phases: [],
  overallStatuses: [],
  partnershipStatus: 'all',
  needsReview: false,
  completionYearFrom: '',
  completionYearTo: '',
  keyword: '',
}

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [selectedCompany, setSelectedCompany] = useState(null)

  useEffect(() => {
    // cache: 'no-store' — 브라우저 HTTP 캐시를 우회해 항상 최신 데이터를 받음
    fetch(PIPELINE_URL, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  const allDrugs = data?.drugs ?? []
  const metadata = data?.metadata

  const filterOptions = useMemo(() => getFilterOptions(allDrugs), [allDrugs])

  const filteredDrugs = useMemo(
    () => applyFilters(allDrugs, filters),
    [allDrugs, filters],
  )

  const companies = useMemo(() => groupByCompany(filteredDrugs), [filteredDrugs])

  const tableDrugs = useMemo(() => {
    if (!selectedCompany) return filteredDrugs
    return filteredDrugs.filter((d) => d.company === selectedCompany)
  }, [filteredDrugs, selectedCompany])

  function handleSelectCompany(company) {
    setSelectedCompany((prev) => (prev === company ? null : company))
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen text-red-500">
        Failed to load data: {error}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-screen text-slate-400 text-sm">
        Loading...
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold text-slate-800 leading-none">
            Oncology Pipeline Intelligence
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Industry-Sponsored Cancer Trials · BD &amp; CDx Opportunity Tracker
          </p>
        </div>
        <div className="text-right text-xs text-slate-400">
          <div>
            <span className="font-semibold text-slate-600">{metadata?.total_drugs?.toLocaleString()}</span> drugs ·{' '}
            <span className="font-semibold text-slate-600">{metadata?.total_companies?.toLocaleString()}</span> companies
          </div>
          <div>Updated: {metadata?.last_updated?.slice(0, 10)}</div>
        </div>
      </header>

      {/* 필터 바 */}
      <FilterBar options={filterOptions} filters={filters} onChange={setFilters} />

      {/* 메인 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 회사 목록 */}
        <CompanyList
          companies={companies}
          selectedCompany={selectedCompany}
          onSelect={handleSelectCompany}
        />

        {/* 파이프라인 테이블 */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {selectedCompany && (
            <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center justify-between text-sm">
              <span className="font-semibold text-blue-800">{selectedCompany}</span>
              <button
                onClick={() => setSelectedCompany(null)}
                className="text-blue-500 hover:text-blue-700 text-xs"
              >
                ✕ Show all
              </button>
            </div>
          )}
          <PipelineTable drugs={tableDrugs} />
        </div>
      </div>
    </div>
  )
}
