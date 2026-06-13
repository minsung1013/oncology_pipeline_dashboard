import { useState, useEffect, useMemo } from 'react'
import FilterBar from '../components/pipeline/FilterBar'
import CompanyList from '../components/pipeline/CompanyList'
import PipelineTable from '../components/pipeline/PipelineTable'
import { applyFilters, getFilterOptions, groupByCompany } from '../utils/filters'
import { getShared, setShared, getTabState, setTabState } from '../utils/filterStore'

const PIPELINE_URL =
  import.meta.env.VITE_PIPELINE_URL ??
  'https://raw.githubusercontent.com/minsung1013/oncology_pipeline_dashboard/main/data/parsed/pipeline.json'

const NCT_INDEX_URL =
  import.meta.env.VITE_NCT_INDEX_URL ??
  'https://raw.githubusercontent.com/minsung1013/oncology_pipeline_dashboard/main/data/parsed/nct_index.json'

// Pipeline 고유(비공유) 필터 기본값
const LOCAL_DEFAULT = {
  partnershipStatus: 'all',
  regimen: 'all',
  needsReview: false,
  completionYear: { from: 'all', to: 'all' },
  keyword: '',
}

// 공유 스토어 + 로컬 슬라이스 → FilterBar용 단일 filters 객체
function buildFilters() {
  const s = getShared()
  const l = getTabState('pipeline') ?? LOCAL_DEFAULT
  return {
    cancerCategories: s.cancers,
    modalities: s.modalities,
    phases: s.phases,
    overallStatuses: s.statuses,
    companies: s.companies,
    targets: s.targets,
    biomarkers: s.biomarkers,
    startYear: s.startYear,
    partnershipStatus: l.partnershipStatus ?? 'all',
    regimen: l.regimen ?? 'all',
    needsReview: l.needsReview ?? false,
    completionYear: l.completionYear ?? { from: 'all', to: 'all' },
    keyword: l.keyword ?? '',
  }
}

export default function PipelinePage() {
  const [data, setData] = useState(null)
  const [nctIndex, setNctIndex] = useState({})
  const [error, setError] = useState(null)
  const [filters, setFiltersState] = useState(buildFilters)
  const [selectedCompany, setSelectedCompany] = useState(() => getTabState('pipeline')?.selectedCompany ?? null)

  function persistLocal(patch) {
    setTabState('pipeline', { ...(getTabState('pipeline') ?? LOCAL_DEFAULT), ...patch })
  }

  // FilterBar 변경 → 공유 축은 store.shared, 고유 축은 store.pipeline 에 분리 저장
  function setFilters(next) {
    setFiltersState(next)
    setShared({
      ...getShared(),
      cancers: next.cancerCategories,
      modalities: next.modalities,
      phases: next.phases,
      statuses: next.overallStatuses,
      companies: next.companies,
      targets: next.targets,
      biomarkers: next.biomarkers,
      startYear: next.startYear,
    })
    persistLocal({
      partnershipStatus: next.partnershipStatus,
      regimen: next.regimen,
      needsReview: next.needsReview,
      completionYear: next.completionYear,
      keyword: next.keyword,
    })
  }

  useEffect(() => {
    fetch(PIPELINE_URL, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))

    fetch(NCT_INDEX_URL, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : {})
      .then(setNctIndex)
      .catch(() => {})
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
    setSelectedCompany((prev) => {
      const next = prev === company ? null : company
      persistLocal({ selectedCompany: next })
      return next
    })
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500">
        Failed to load data: {error}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-bold text-slate-800 leading-none">
            Clinical Trial Pipeline
          </h2>
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
          <PipelineTable drugs={tableDrugs} nctIndex={nctIndex} />
        </div>
      </div>
    </div>
  )
}
