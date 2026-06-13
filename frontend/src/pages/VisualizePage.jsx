import { useState, useEffect, useMemo } from 'react'
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
  aggregateByPhase,
  aggregateByModality,
  aggregateBiomarker,
  getSummaryStats,
} from '../utils/visualizeAggregations'

const PIPELINE_URL =
  import.meta.env.VITE_PIPELINE_URL ??
  'https://raw.githubusercontent.com/minsung1013/oncology_pipeline_dashboard/main/data/parsed/pipeline.json'

const DEFAULT_FILTERS = { companies: [], cancers: [] }

export default function VisualizePage() {
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

  const stats = useMemo(() => getSummaryStats(drugs), [drugs])
  const companyData = useMemo(() => aggregateByField(drugs, 'company', topN), [drugs, topN])
  const cancerData = useMemo(() => aggregateByField(drugs, 'cancer_category', topN), [drugs, topN])
  const targetData = useMemo(() => aggregateByField(drugs, 'target', topN), [drugs, topN])
  const phaseData = useMemo(() => aggregateByPhase(drugs), [drugs])
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

  const summary =
    filters.companies.length > 0 || filters.cancers.length > 0
      ? `${[...filters.companies, ...filters.cancers].join(', ')} — ${drugs.length.toLocaleString()} records`
      : `All trials — ${drugs.length.toLocaleString()} records`

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
        <VisualizeFilterBar
          options={options}
          filters={filters}
          onChange={setFilters}
          topN={topN}
          onTopNChange={setTopN}
        />
      </div>

      {/* Scrollable charts */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <SummaryCards stats={stats} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CompanyDistributionChart data={companyData} />
          <PhaseDistributionChart data={phaseData} />
          <CancerTypeDistributionChart data={cancerData} />
          <ModalityDistributionChart data={modalityData} />
          <TargetDistributionChart data={targetData} />
          <BiomarkerChart data={biomarkerData} />
        </div>
      </div>
    </div>
  )
}
