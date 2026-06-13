import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import VisualizeFilterBar from '../components/visualize/VisualizeFilterBar'
import SummaryCards from '../components/visualize/SummaryCards'
import CompanyDistributionChart from '../components/visualize/CompanyDistributionChart'
import PhaseDistributionChart from '../components/visualize/PhaseDistributionChart'
import CancerTypeDistributionChart from '../components/visualize/CancerTypeDistributionChart'
import ModalityDistributionChart from '../components/visualize/ModalityDistributionChart'
import TargetDistributionChart from '../components/visualize/TargetDistributionChart'
import BiomarkerChart from '../components/visualize/BiomarkerChart'
import {
  getVisualizeOptions,
  applyVisualizeFilters,
  aggregateByField,
  aggregateByPhaseStatus,
  aggregateByModality,
  aggregateBiomarker,
  getSummaryStats,
  phaseLabel,
} from '../utils/visualizeAggregations'

const PIPELINE_URL =
  import.meta.env.VITE_PIPELINE_URL ??
  'https://raw.githubusercontent.com/minsung1013/oncology_pipeline_dashboard/main/data/parsed/pipeline.json'

const DEFAULT_FILTERS = {
  companies: [], cancers: [], phases: [], modalities: [], targets: [], biomarkers: [],
  startYear: { from: 'all', to: 'all' },
}

// 필터칩 표시용 (key → 라벨, 값 렌더러)
const CHIP_META = {
  companies: { label: 'Company', render: (v) => v },
  cancers: { label: 'Cancer', render: (v) => v },
  phases: { label: 'Phase', render: phaseLabel },
  modalities: { label: 'Modality', render: (v) => v },
  targets: { label: 'Target', render: (v) => v },
  biomarkers: { label: 'Biomarker', render: (v) => v },
}

// Visualize의 단일 phase 필드(콤보 'PHASE1/PHASE2') → Pipeline의 개별 phase 배열
function expandPhases(phases) {
  const out = new Set()
  for (const p of phases) {
    for (const seg of p.split('/')) out.add(seg === 'UNKNOWN' ? 'NA' : seg)
  }
  return [...out]
}

export default function VisualizePage() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [topN, setTopN] = useState(10)

  useEffect(() => {
    // browser HTTP 캐시 허용 (Pipeline 탭과 동일 파일 — 중복 fetch 비용 완화)
    fetch(PIPELINE_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  const allDrugs = data?.drugs ?? []

  const options = useMemo(() => getVisualizeOptions(allDrugs), [allDrugs])
  const drugs = useMemo(() => applyVisualizeFilters(allDrugs, filters), [allDrugs, filters])

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
  const companyData = useMemo(() => aggregateByField(drugs, 'company', topN), [drugs, topN])
  const cancerData = useMemo(() => aggregateByField(drugs, 'cancer_category', topN), [drugs, topN])
  const targetData = useMemo(() => aggregateByField(drugs, 'target', topN), [drugs, topN])
  const phaseData = useMemo(() => aggregateByPhaseStatus(drugs), [drugs])
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

  function applyToPipeline() {
    const pipelineFilters = {
      cancerCategories: filters.cancers,
      modalities: filters.modalities,
      phases: expandPhases(filters.phases),
      companies: filters.companies,
      targets: filters.targets,
      biomarkers: filters.biomarkers,
      startYear: filters.startYear,
    }
    navigate('/', { state: { pipelineFilters } })
  }

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
          <button
            onClick={applyToPipeline}
            disabled={!hasActive}
            title={hasActive ? 'Open the Pipeline table with these filters applied' : 'Select at least one filter first'}
            className={`text-xs font-semibold px-3 py-1.5 rounded border transition-colors ${
              hasActive
                ? 'border-blue-500 bg-blue-600 text-white hover:bg-blue-700'
                : 'border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed'
            }`}
          >
            Apply to Pipeline →
          </button>
        </div>
        <VisualizeFilterBar
          options={options}
          filters={filters}
          onChange={setFilters}
          topN={topN}
          onTopNChange={setTopN}
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
              onClick={() => setFilters(DEFAULT_FILTERS)}
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
          <PhaseDistributionChart
            data={phaseData}
            selected={filters.phases}
            onSelect={(v) => toggleFilter('phases', v)}
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
        </div>
      </div>
    </div>
  )
}
