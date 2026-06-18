import { useState, useEffect, useMemo } from 'react'
import ChartCard from '../components/visualize/ChartCard'
import DistributionBarChart from '../components/visualize/DistributionBarChart'
import AbstractsByYearChart from '../components/visualize/AbstractsByYearChart'
import {
  filterAbstractsForVisualize,
  aggregateAbstractsByYear,
  aggregateAbstractListField,
  aggregateAbstractsByCompany,
  aggregateAbstractsByInstitution,
  aggregateAbstractsByCountry,
  aggregateAbstractsByPhase,
  getAbstractSummaryStats,
  phaseLabel,
} from '../utils/visualizeAggregations'
import { getShared, setShared, getTabState, setTabState } from '../utils/filterStore'
import { getAbstractIndex, loadAbstractFiles } from '../utils/dataSource'

// CDx 친화 신호: 타겟/모달리티 강조 (Pipeline 시각화와 동일 신호 체계)
const CDX_TARGETS = new Set(['HER2', 'PD-L1', 'TROP2', 'EGFR', 'CLDN18.2', 'MET'])
const CDX_MODALITIES = new Set(['ADC', 'Bispecific Antibody', 'CAR-T', 'Cell Therapy'])

// 클릭 가능한 차트가 토글하는 공유 필터 축
const CHIP_META = {
  modalities: 'Modality',
  targets: 'Target',
  biomarkers: 'Biomarker',
  cancers: 'Cancer',
  companies: 'Company',
  phases: 'Phase',
}

function Card({ label, value, accent }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-col">
      <span className="text-xs text-slate-400 uppercase tracking-wide">{label}</span>
      <span className={`text-2xl font-bold ${accent ?? 'text-slate-800'}`}>{value}</span>
    </div>
  )
}

function SummaryCards({ stats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card label="Abstracts" value={stats.total.toLocaleString()} />
      <Card label="Companies" value={stats.uniqueCompanies.toLocaleString()} />
      <Card label="Cancer Types" value={stats.uniqueCancerTypes.toLocaleString()} />
      <Card label="Therapeutic" value={`${stats.therapeuticPct}%`} accent="text-violet-600" />
    </div>
  )
}

export default function ConferenceVisualizePage() {
  const [abstracts, setAbstracts] = useState(null)
  const [error, setError] = useState(null)
  const [filters, setFiltersState] = useState(getShared)
  const [topN, setTopNState] = useState(() => getTabState('conference-visualize')?.topN ?? 10)

  // 공유 축 변경 → store.shared 동기화 (다른 탭과 필터 공유)
  function setFilters(updater) {
    setFiltersState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      setShared(next)
      return next
    })
  }
  function setTopN(v) {
    setTopNState(v)
    setTabState('conference-visualize', { topN: v })
  }

  // 전 학회·연도 초록 로드 (모듈 캐시 → 재방문 시 즉시)
  useEffect(() => {
    getAbstractIndex()
      .then((index) => loadAbstractFiles(index))
      .then(setAbstracts)
      .catch((e) => setError(e.message))
  }, [])

  const toggleFilter = (key, value) => {
    setFilters((prev) => {
      const cur = prev[key] ?? []
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
      return { ...prev, [key]: next }
    })
  }

  const filtered = useMemo(
    () => (abstracts ? filterAbstractsForVisualize(abstracts, filters) : []),
    [abstracts, filters],
  )

  const confList = useMemo(
    () => (abstracts ? [...new Set(abstracts.map((a) => a.conference))].sort() : []),
    [abstracts],
  )

  const stats = useMemo(() => getAbstractSummaryStats(filtered), [filtered])
  const yearData = useMemo(() => aggregateAbstractsByYear(filtered), [filtered])
  const modalityData = useMemo(() => aggregateAbstractListField(filtered, 'modality_list', topN), [filtered, topN])
  const targetData = useMemo(() => aggregateAbstractListField(filtered, 'target_list', topN, { excludeUnknown: true }), [filtered, topN])
  const biomarkerData = useMemo(() => aggregateAbstractListField(filtered, 'biomarker_list', topN), [filtered, topN])
  const cancerData = useMemo(() => aggregateAbstractListField(filtered, 'cancer_category', topN), [filtered, topN])
  const companyData = useMemo(() => aggregateAbstractsByCompany(filtered, topN), [filtered, topN])
  const institutionData = useMemo(() => aggregateAbstractsByInstitution(filtered, topN), [filtered, topN])
  const phaseData = useMemo(() => aggregateAbstractsByPhase(filtered), [filtered])
  const countryData = useMemo(() => aggregateAbstractsByCountry(filtered, topN), [filtered, topN])

  const activeChips = Object.keys(CHIP_META)
    .flatMap((key) => (filters[key] ?? []).map((value) => ({ key, value })))
  const hasActive = activeChips.length > 0

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500">
        Failed to load abstracts: {error}
      </div>
    )
  }

  if (!abstracts) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Loading conference abstracts…
      </div>
    )
  }

  const summary = hasActive
    ? `${filtered.length.toLocaleString()} of ${abstracts.length.toLocaleString()} abstracts match ${activeChips.length} filter${activeChips.length > 1 ? 's' : ''}`
    : `All conferences — ${abstracts.length.toLocaleString()} abstracts`

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-base font-bold text-slate-800 leading-none">
              Conference Visualization
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">{summary}</p>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Top
            <select
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value))}
              className="border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
            >
              {[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>

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
                <span className="text-blue-400">{CHIP_META[key]}:</span>
                {key === 'phases' ? phaseLabel(value) : value}
                <span className="text-blue-400">✕</span>
              </button>
            ))}
            <button
              onClick={() => setFilters((prev) => ({
                ...prev, modalities: [], targets: [], biomarkers: [], cancers: [], companies: [], phases: [],
              }))}
              className="text-xs text-slate-400 hover:text-slate-600 ml-1"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <SummaryCards stats={stats} />

        <AbstractsByYearChart data={yearData} confs={confList} filtered={hasActive} loading={false} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DistributionBarChart
            title="Modality Distribution"
            subtitle="Therapeutic modalities studied — click a bar to filter (CDx-synergistic highlighted)"
            data={modalityData}
            selected={filters.modalities ?? []}
            highlight={CDX_MODALITIES}
            baseColor="#8b5cf6"
            selectedColor="#6d28d9"
            onSelect={(v) => toggleFilter('modalities', v)}
          />
          <DistributionBarChart
            title="Target Distribution"
            subtitle="Drug targets in abstracts — click a bar to filter (IHC-friendly highlighted)"
            data={targetData}
            selected={filters.targets ?? []}
            highlight={CDX_TARGETS}
            onSelect={(v) => toggleFilter('targets', v)}
          />
          <DistributionBarChart
            title="Biomarker Distribution"
            subtitle="Patient-selection / prognostic biomarkers — click a bar to filter"
            data={biomarkerData}
            selected={filters.biomarkers ?? []}
            baseColor="#f43f5e"
            selectedColor="#be123c"
            onSelect={(v) => toggleFilter('biomarkers', v)}
          />
          <DistributionBarChart
            title="Cancer Type Distribution"
            subtitle="Abstracts per cancer category — click a bar to filter"
            data={cancerData}
            selected={filters.cancers ?? []}
            baseColor="#10b981"
            selectedColor="#047857"
            yWidth={110}
            onSelect={(v) => toggleFilter('cancers', v)}
          />
          <DistributionBarChart
            title="Top Companies"
            subtitle="Normalized company presence across abstracts — click a bar to filter"
            data={companyData}
            selected={filters.companies ?? []}
            yWidth={120}
            onSelect={(v) => toggleFilter('companies', v)}
          />
          <DistributionBarChart
            title="Top Institutions"
            subtitle="First-author affiliation, normalized to university / company level"
            data={institutionData}
            baseColor="#6366f1"
            yWidth={150}
          />
          <DistributionBarChart
            title="Phase Distribution"
            subtitle="Trial phase mix across abstracts"
            data={phaseData}
            yWidth={70}
          />
          <DistributionBarChart
            title="Top Countries"
            subtitle="First-author country across abstracts"
            data={countryData}
            baseColor="#0ea5e9"
            yWidth={120}
          />
          <ChartCard title="Datasets" subtitle="Conference × year coverage" height={320}>
            <div className="h-full flex flex-col items-center justify-center gap-1 text-center">
              <span className="text-4xl font-bold text-slate-800">{stats.datasets}</span>
              <span className="text-xs text-slate-400">conference-year datasets in view</span>
            </div>
          </ChartCard>
        </div>
      </div>
    </div>
  )
}
