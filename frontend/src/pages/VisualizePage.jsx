import { useState, useEffect, useMemo } from 'react'
import DrugFilterBar from '../components/common/DrugFilterBar'
import SummaryCards from '../components/visualize/SummaryCards'
import CompanyDistributionChart from '../components/visualize/CompanyDistributionChart'
import DrugDistributionChart from '../components/visualize/DrugDistributionChart'
import PhaseDistributionChart from '../components/visualize/PhaseDistributionChart'
import CancerTypeDistributionChart from '../components/visualize/CancerTypeDistributionChart'
import ModalityDistributionChart from '../components/visualize/ModalityDistributionChart'
import TargetDistributionChart from '../components/visualize/TargetDistributionChart'
import BiomarkerChart from '../components/visualize/BiomarkerChart'
import StatusDistributionChart from '../components/visualize/StatusDistributionChart'
import AbstractsByYearChart from '../components/visualize/AbstractsByYearChart'
import { statusLabel } from '../components/visualize/statusMeta'
import {
  aggregateByField,
  aggregateByAccessor,
  aggregateByPhaseStatus,
  aggregateByStatus,
  aggregateByModality,
  aggregateBiomarker,
  filterAbstractsForVisualize,
  aggregateAbstractsByYear,
  manifestByYear,
  getSummaryStats,
  phaseLabel,
} from '../utils/visualizeAggregations'
import { getDrugFilterOptions, applyDrugFilters, DRUG_FILTER_DEFAULT, drugCompanies } from '../utils/drugFilters'
import { getShared, setShared, getTabState, setTabState } from '../utils/filterStore'
import { getPipeline, getAbstractIndex, loadAbstractFiles } from '../utils/dataSource'

const EMPTY_FILTERS = DRUG_FILTER_DEFAULT

// 필터칩 표시용 (key → 라벨, 값 렌더러)
const CHIP_META = {
  companies: { label: 'Company', render: (v) => v },
  drugs: { label: 'Drug', render: (v) => v },
  cancers: { label: 'Cancer', render: (v) => v },
  phases: { label: 'Phase', render: phaseLabel },
  modalities: { label: 'Modality', render: (v) => v },
  targets: { label: 'Target', render: (v) => v },
  biomarkers: { label: 'Biomarker', render: (v) => v },
  statuses: { label: 'Status', render: statusLabel },
}

export default function VisualizePage() {
  const [data, setData] = useState(null)
  const [abstractManifest, setAbstractManifest] = useState(null)
  const [allAbstracts, setAllAbstracts] = useState(null)
  const [error, setError] = useState(null)
  const [filters, setFiltersState] = useState(getShared)
  const [topN, setTopNState] = useState(() => getTabState('visualize')?.topN ?? 10)

  // Visualize의 모든 축은 공유 축 → 변경 시 store.shared 에 동기화
  function setFilters(updater) {
    setFiltersState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      // 공유 축만 store에 병합 (institutions 등 타 탭 키 보존)
      setShared({
        ...getShared(),
        companies: next.companies, drugs: next.drugs, cancers: next.cancers,
        phases: next.phases, modalities: next.modalities, targets: next.targets,
        biomarkers: next.biomarkers, statuses: next.statuses,
        startYear: next.startYear, keyword: next.keyword,
      })
      return next
    })
  }
  function setTopN(v) {
    setTopNState(v)
    setTabState('visualize', { topN: v })
  }

  useEffect(() => {
    getPipeline().then(setData).catch((e) => setError(e.message))

    // 통합 "연도별 초록 수" 차트: manifest만 사용 (초록 전체 로드 불필요)
    getAbstractIndex().then(setAbstractManifest).catch(() => {})
  }, [])

  const allDrugs = data?.drugs ?? []

  // 초록 관련 공유 필터가 활성화되면 전체 초록을 1회 로드(캐시) → 필터 반응형 차트
  const abstractFilterActive =
    filters.cancers.length || filters.phases.length || filters.modalities.length ||
    filters.companies.length || filters.targets.length || filters.biomarkers.length
  useEffect(() => {
    if (abstractFilterActive && !allAbstracts && abstractManifest) {
      loadAbstractFiles(abstractManifest).then(setAllAbstracts).catch(() => {})
    }
  }, [abstractFilterActive, allAbstracts, abstractManifest])

  const confList = useMemo(
    () => (abstractManifest ? [...new Set(abstractManifest.map((m) => m.conference))].sort() : []),
    [abstractManifest],
  )
  const abstractYearData = useMemo(() => {
    if (abstractFilterActive) {
      if (!allAbstracts) return null  // loading
      return aggregateAbstractsByYear(filterAbstractsForVisualize(allAbstracts, filters))
    }
    return abstractManifest ? manifestByYear(abstractManifest) : null
  }, [abstractFilterActive, allAbstracts, abstractManifest, filters])

  const options = useMemo(() => getDrugFilterOptions(allDrugs), [allDrugs])
  const drugs = useMemo(() => applyDrugFilters(allDrugs, filters), [allDrugs, filters])

  // 그래프 클릭 → 해당 축 필터 토글
  const toggleFilter = (key, value) => {
    setFilters((prev) => {
      const cur = prev[key]
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
      return { ...prev, [key]: next }
    })
  }

  const activeChips = Object.entries(filters)
    .filter(([, vals]) => Array.isArray(vals))
    .flatMap(([key, vals]) => vals.map((v) => ({ key, value: v })))
  const yearActive = filters.startYear.from !== 'all' || filters.startYear.to !== 'all'
  const activeCount = activeChips.length + (yearActive ? 1 : 0)
  const hasActive = activeCount > 0

  const stats = useMemo(() => getSummaryStats(drugs), [drugs])
  // 정규 제약사명 기준, 메인 스폰서 + 협력사 동등 집계 (미인식 회사는 제외)
  const companyData = useMemo(
    () => aggregateByAccessor(drugs.filter((d) => drugCompanies(d).length), drugCompanies, topN),
    [drugs, topN],
  )
  const drugData = useMemo(() => aggregateByField(drugs, 'drug_name', topN), [drugs, topN])
  const cancerData = useMemo(() => aggregateByField(drugs, 'cancer_category', topN), [drugs, topN])
  const targetData = useMemo(() => aggregateByField(drugs, 'target', topN), [drugs, topN])
  const phaseData = useMemo(() => aggregateByPhaseStatus(drugs), [drugs])
  const statusData = useMemo(() => aggregateByStatus(drugs), [drugs])
  const modalityData = useMemo(() => aggregateByModality(drugs), [drugs])
  const biomarkerData = useMemo(() => aggregateBiomarker(drugs), [drugs])

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
        Loading pipeline…
      </div>
    )
  }

  const summary = hasActive
    ? `${drugs.length.toLocaleString()} records match ${activeCount} filter${activeCount > 1 ? 's' : ''}`
    : `All trials — ${drugs.length.toLocaleString()} records`

  const yearChipLabel = `${filters.startYear.from === 'all' ? '…' : filters.startYear.from}–${filters.startYear.to === 'all' ? '…' : filters.startYear.to}`

  return (
    <div className="flex flex-col h-full">
      {/* Header + filter bar */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-base font-bold text-slate-800 leading-none">
              Pipeline Visualization
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">{summary}</p>
          </div>
        </div>
        <DrugFilterBar
          options={options}
          filters={filters}
          onChange={setFilters}
          extras={
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span>Top N</span>
              <select
                value={topN}
                onChange={(e) => setTopN(Number(e.target.value))}
                className="border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
              >
                {[5, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          }
        />

        {/* Active filter chips */}
        {hasActive && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {activeChips.map(({ key, value }) => (
              <button
                key={`${key}:${value}`}
                onClick={() => toggleFilter(key, value)}
                className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                title="Remove filter"
              >
                <span className="text-blue-400">{CHIP_META[key].label}:</span>
                {CHIP_META[key].render(value)}
                <span className="text-blue-400">✕</span>
              </button>
            ))}
            {yearActive && (
              <button
                onClick={() => setFilters((prev) => ({ ...prev, startYear: { from: 'all', to: 'all' } }))}
                className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                title="Remove filter"
              >
                <span className="text-blue-400">Start:</span>
                {yearChipLabel}
                <span className="text-blue-400">✕</span>
              </button>
            )}
            <button
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="text-xs text-slate-400 hover:text-slate-600 ml-1"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Scrollable charts */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <SummaryCards stats={stats} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CompanyDistributionChart
            data={companyData}
            selected={filters.companies}
            onSelect={(v) => toggleFilter('companies', v)}
          />
          <DrugDistributionChart
            data={drugData}
            selected={filters.drugs}
            onSelect={(v) => toggleFilter('drugs', v)}
          />
          <PhaseDistributionChart
            data={phaseData}
            onSelect={(v) => toggleFilter('phases', v)}
          />
          <StatusDistributionChart
            counts={statusData}
            selected={filters.statuses}
            onSelect={(v) => toggleFilter('statuses', v)}
          />
          <CancerTypeDistributionChart
            data={cancerData}
            selected={filters.cancers}
            onSelect={(v) => toggleFilter('cancers', v)}
          />
          <ModalityDistributionChart
            data={modalityData}
            selected={filters.modalities}
            onSelect={(v) => toggleFilter('modalities', v)}
          />
          <TargetDistributionChart
            data={targetData}
            selected={filters.targets}
            onSelect={(v) => toggleFilter('targets', v)}
          />
          <BiomarkerChart
            data={biomarkerData}
            selected={filters.biomarkers}
            onSelect={(v) => toggleFilter('biomarkers', v)}
          />
          <AbstractsByYearChart
            data={abstractYearData}
            confs={confList}
            filtered={!!abstractFilterActive}
            loading={!!abstractFilterActive && !allAbstracts}
          />
        </div>
      </div>
    </div>
  )
}
