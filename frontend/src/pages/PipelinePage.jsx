import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import DrugFilterBar from '../components/common/DrugFilterBar'
import CompanyList from '../components/pipeline/CompanyList'
import PipelineTable from '../components/pipeline/PipelineTable'
import { applyDrugFilters, getDrugFilterOptions, groupByCompany } from '../utils/drugFilters'
import { getShared, setShared, getTabState, setTabState } from '../utils/filterStore'

import { getPipeline, getNctIndex } from '../utils/dataSource'

// Pipeline 고유(비공유) 필터 기본값
const LOCAL_DEFAULT = {
  partnershipStatus: 'all',
  regimen: 'all',
  needsReview: false,
  completionYear: { from: 'all', to: 'all' },
}

// 공유 스토어(표준 축) + Pipeline 로컬 슬라이스 → 단일 filters 객체 (canonical 키)
function buildFilters() {
  const s = getShared()
  const l = getTabState('pipeline') ?? LOCAL_DEFAULT
  return {
    companies: s.companies,
    drugs: s.drugs,
    cancers: s.cancers,
    phases: s.phases,
    modalities: s.modalities,
    targets: s.targets,
    biomarkers: s.biomarkers,
    statuses: s.statuses,
    startYear: s.startYear,
    keyword: s.keyword ?? '',
    completionYear: l.completionYear ?? { from: 'all', to: 'all' },
    partnershipStatus: l.partnershipStatus ?? 'all',
    regimen: l.regimen ?? 'all',
    needsReview: l.needsReview ?? false,
  }
}

export default function PipelinePage() {
  const [data, setData] = useState(null)
  const [nctIndex, setNctIndex] = useState({})
  const [error, setError] = useState(null)
  const [filters, setFiltersState] = useState(buildFilters)
  const [searchParams, setSearchParams] = useSearchParams()
  const nctParam = searchParams.get('nct')  // Conference에서 NCT 클릭 시 → 해당 시험만
  const [selectedCompany, setSelectedCompany] = useState(() => getTabState('pipeline')?.selectedCompany ?? null)
  // 회사 목록 사이드바: 데스크톱 기본 펼침, 모바일 기본 접힘
  const [showCompanies, setShowCompanies] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 768,
  )

  function persistLocal(patch) {
    setTabState('pipeline', { ...(getTabState('pipeline') ?? LOCAL_DEFAULT), ...patch })
  }

  // FilterBar 변경 → 공유 축은 store.shared, 고유 축은 store.pipeline 에 분리 저장
  function setFilters(next) {
    setFiltersState(next)
    setShared({
      ...getShared(),
      companies: next.companies,
      drugs: next.drugs,
      cancers: next.cancers,
      modalities: next.modalities,
      phases: next.phases,
      statuses: next.statuses,
      targets: next.targets,
      biomarkers: next.biomarkers,
      startYear: next.startYear,
      keyword: next.keyword,
    })
    persistLocal({
      partnershipStatus: next.partnershipStatus,
      regimen: next.regimen,
      needsReview: next.needsReview,
      completionYear: next.completionYear,
    })
  }

  useEffect(() => {
    getPipeline().then(setData).catch((e) => setError(e.message))
    getNctIndex().then(setNctIndex).catch(() => {})
  }, [])

  const allDrugs = data?.drugs ?? []
  const metadata = data?.metadata

  const filterOptions = useMemo(() => getDrugFilterOptions(allDrugs), [allDrugs])

  // NCT로 넘어오면 해당 시험만 (다른 필터 무시), 아니면 일반 필터
  const filteredDrugs = useMemo(() => {
    if (nctParam) return allDrugs.filter((d) => (d.nct_ids ?? []).includes(nctParam))
    return applyDrugFilters(allDrugs, filters)
  }, [allDrugs, filters, nctParam])

  const companies = useMemo(() => groupByCompany(filteredDrugs), [filteredDrugs])

  const tableDrugs = useMemo(() => {
    if (nctParam || !selectedCompany) return filteredDrugs
    return filteredDrugs.filter((d) => d.company === selectedCompany)
  }, [filteredDrugs, selectedCompany, nctParam])

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

      {/* Conference에서 넘어온 NCT 포커스 배너 (해제 가능) */}
      {nctParam && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 flex items-center gap-2 text-xs shrink-0">
          <span className="text-amber-800">Showing trial</span>
          <span className="font-mono font-semibold text-amber-900">{nctParam}</span>
          <a
            href={`https://clinicaltrials.gov/study/${nctParam}`}
            target="_blank" rel="noreferrer"
            className="text-amber-600 hover:text-amber-800"
            title="Open on ClinicalTrials.gov"
          >↗</a>
          <button
            onClick={() => setSearchParams({})}
            className="ml-1 text-amber-500 hover:text-amber-700"
            title="Clear NCT filter"
          >✕ clear</button>
        </div>
      )}

      {/* 필터 바 (공용) + Pipeline 고유 컨트롤 */}
      <DrugFilterBar
        options={filterOptions}
        filters={filters}
        onChange={setFilters}
        showCompletion
        extras={<PipelineExtras filters={filters} onChange={setFilters} />}
      />

      {/* 메인 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 회사 목록 (접기 가능) */}
        {showCompanies && (
          <CompanyList
            companies={companies}
            selectedCompany={selectedCompany}
            onSelect={handleSelectCompany}
            onClose={() => setShowCompanies(false)}
          />
        )}

        {/* 파이프라인 테이블 */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* 토글 + 선택 회사 바 */}
          <div className="bg-slate-50 border-b border-slate-200 px-3 py-1.5 flex items-center gap-2 text-sm shrink-0">
            <button
              onClick={() => setShowCompanies((v) => !v)}
              className="text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded px-2 py-0.5 bg-white"
              title={showCompanies ? 'Hide company list' : 'Show company list'}
            >
              {showCompanies ? '◀ Companies' : '▶ Companies'}
            </button>
            {selectedCompany && (
              <span className="flex items-center gap-2 text-blue-800">
                <span className="font-semibold">{selectedCompany}</span>
                <button
                  onClick={() => setSelectedCompany(null)}
                  className="text-blue-500 hover:text-blue-700 text-xs"
                >
                  ✕ Show all
                </button>
              </span>
            )}
          </div>
          <PipelineTable drugs={tableDrugs} nctIndex={nctIndex} />
        </div>
      </div>
    </div>
  )
}

// Pipeline 전용 필터 컨트롤 (공용 FilterBar의 extras 슬롯에 주입)
function PipelineExtras({ filters, onChange }) {
  const set = (key, value) => onChange({ ...filters, [key]: value })
  const sel = 'border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400'
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Partnership</span>
        <select value={filters.partnershipStatus} onChange={(e) => set('partnershipStatus', e.target.value)} className={sel}>
          <option value="all">All</option>
          <option value="solo">Solo</option>
          <option value="partnered">Partnered</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Regimen</span>
        <select value={filters.regimen} onChange={(e) => set('regimen', e.target.value)} className={sel}>
          <option value="all">All</option>
          <option value="mono">Monotherapy</option>
          <option value="combo">Combination</option>
        </select>
      </div>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={filters.needsReview}
          onChange={(e) => set('needsReview', e.target.checked)}
          className="w-4 h-4 accent-orange-500"
        />
        <span className="text-slate-600">Unknown target only</span>
      </label>
    </>
  )
}
