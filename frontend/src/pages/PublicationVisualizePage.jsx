import { useState, useEffect, useMemo } from 'react'
import ChartCard from '../components/visualize/ChartCard'
import DistributionBarChart from '../components/visualize/DistributionBarChart'
import AbstractsByYearChart from '../components/visualize/AbstractsByYearChart'
import TrendLineChart from '../components/visualize/TrendLineChart'
import ConferenceFilterBar from '../components/conferences/ConferenceFilterBar'
import ConferenceActiveChips from '../components/conferences/ConferenceActiveChips'
import {
  aggregateAbstractListField, aggregateAbstractsByCompany, aggregateAbstractsByInstitution,
  aggregateAbstractsByCountry, aggregateAbstractScalar, aggregateByYearSingle,
  aggregateTrendByYear, getAbstractSummaryStats,
} from '../utils/visualizeAggregations'
import { applyAbstractFilters, getAbstractFilterOptions } from '../utils/abstractFilters'
import {
  buildPublicationFilters, setPublicationFilter, clearedPublicationFilters, anyPublicationFilter,
} from '../utils/publicationFilters'
import { getTabState, setTabState } from '../utils/filterStore'
import { getPublicationIndex, loadPublicationFiles } from '../utils/dataSource'

const TREND_N = 6
const CDX_TARGETS = new Set(['HER2', 'PD-L1', 'TROP2', 'EGFR', 'CLDN18.2', 'MET'])
const CDX_MODALITIES = new Set(['ADC', 'Bispecific Antibody', 'CAR-T', 'Cell Therapy'])

function Card({ label, value, accent }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-col">
      <span className="text-xs text-slate-400 uppercase tracking-wide">{label}</span>
      <span className={`text-2xl font-bold ${accent ?? 'text-slate-800'}`}>{value}</span>
    </div>
  )
}

export default function PublicationVisualizePage() {
  const [abstracts, setAbstracts] = useState(null)
  const [error, setError] = useState(null)
  const [filters, setFiltersState] = useState(buildPublicationFilters)
  const [topN, setTopNState] = useState(() => getTabState('publication-visualize')?.topN ?? 10)

  const setFilter = (key, value) => setFiltersState((prev) => setPublicationFilter(prev, key, value))
  const toggleFilter = (key, value) =>
    setFiltersState((prev) => {
      const cur = prev[key] ?? []
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
      return setPublicationFilter(prev, key, next)
    })
  const clearAll = () => setFiltersState(clearedPublicationFilters())
  function setTopN(v) { setTopNState(v); setTabState('publication-visualize', { topN: v }) }

  useEffect(() => {
    getPublicationIndex().then((idx) => loadPublicationFiles(idx)).then(setAbstracts).catch((e) => setError(e.message))
  }, [])

  const options = useMemo(
    () => (abstracts ? getAbstractFilterOptions(abstracts) : { cancers: [], modalities: [], targets: [], biomarkers: [], companies: [], phases: [], conferences: [], years: [], countries: [], presentationKinds: [] }),
    [abstracts],
  )
  const filtered = useMemo(() => (abstracts ? applyAbstractFilters(abstracts, filters) : []), [abstracts, filters])

  const stats = useMemo(() => getAbstractSummaryStats(filtered), [filtered])
  const yearData = useMemo(() => aggregateByYearSingle(filtered, 'Publications'), [filtered])
  const modalityData = useMemo(() => aggregateAbstractListField(filtered, 'modality_list', topN), [filtered, topN])
  const targetData = useMemo(() => aggregateAbstractListField(filtered, 'target_list', topN, { excludeUnknown: true }), [filtered, topN])
  const biomarkerData = useMemo(() => aggregateAbstractListField(filtered, 'biomarker_list', topN), [filtered, topN])
  const cancerData = useMemo(() => aggregateAbstractListField(filtered, 'cancer_category', topN), [filtered, topN])
  const companyData = useMemo(() => aggregateAbstractsByCompany(filtered, topN), [filtered, topN])
  const institutionData = useMemo(() => aggregateAbstractsByInstitution(filtered, topN), [filtered, topN])
  const countryData = useMemo(() => aggregateAbstractsByCountry(filtered, topN), [filtered, topN])
  const journalData = useMemo(() => aggregateAbstractScalar(filtered, (a) => a.conference, topN), [filtered, topN])
  const ptypeData = useMemo(() => aggregateAbstractScalar(filtered, (a) => a.presentation_type, topN), [filtered, topN])

  const modalityTrend = useMemo(() => aggregateTrendByYear(filtered, 'modality_list', TREND_N), [filtered])
  const targetTrend = useMemo(() => aggregateTrendByYear(filtered, 'target_list', TREND_N, { excludeUnknown: true }), [filtered])
  const biomarkerTrend = useMemo(() => aggregateTrendByYear(filtered, 'biomarker_list', TREND_N), [filtered])
  const cancerTrend = useMemo(() => aggregateTrendByYear(filtered, 'cancer_category', TREND_N), [filtered])

  const hasActive = anyPublicationFilter(filters, null)

  if (error) return <div className="flex items-center justify-center h-full text-red-500">Failed to load publications: {error}</div>
  if (!abstracts) return <div className="flex items-center justify-center h-full text-slate-400 text-sm">Loading publications…</div>

  const summary = hasActive
    ? `${filtered.length.toLocaleString()} of ${abstracts.length.toLocaleString()} publications match the current filters`
    : `All journals — ${abstracts.length.toLocaleString()} NCT-linked publications`

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-slate-200 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-base font-bold text-slate-800 leading-none">Publication Visualization</h2>
            <p className="text-xs text-slate-400 mt-0.5">{summary}</p>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Top
            <select value={topN} onChange={(e) => setTopN(Number(e.target.value))}
              className="border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400">
              {[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-2">
          <ConferenceFilterBar options={options} filters={filters} onChange={setFilter} onClear={clearAll} hasActive={hasActive} />
        </div>
        <ConferenceActiveChips filters={filters} onChange={setFilter} />
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card label="Publications" value={stats.total.toLocaleString()} />
          <Card label="Companies" value={stats.uniqueCompanies.toLocaleString()} />
          <Card label="Cancer Types" value={stats.uniqueCancerTypes.toLocaleString()} />
          <Card label="Therapeutic" value={`${stats.therapeuticPct}%`} accent="text-violet-600" />
        </div>

        <AbstractsByYearChart data={yearData} confs={['Publications']} filtered={hasActive} loading={false} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DistributionBarChart title="Modality Distribution" subtitle="Therapeutic modalities — click a bar to filter"
            data={modalityData} selected={filters.modalities ?? []} highlight={CDX_MODALITIES}
            baseColor="#8b5cf6" selectedColor="#6d28d9" onSelect={(v) => toggleFilter('modalities', v)} />
          <TrendLineChart title="Modality Trend by Year" subtitle="Publications per year — top 6 modalities" data={modalityTrend.rows} keys={modalityTrend.keys} />

          <DistributionBarChart title="Target Distribution" subtitle="Drug targets — click a bar to filter (IHC-friendly highlighted)"
            data={targetData} selected={filters.targets ?? []} highlight={CDX_TARGETS} onSelect={(v) => toggleFilter('targets', v)} />
          <TrendLineChart title="Target Trend by Year" subtitle="Publications per year — top 6 targets" data={targetTrend.rows} keys={targetTrend.keys} />

          <DistributionBarChart title="Biomarker Distribution" subtitle="Patient-selection / prognostic biomarkers — click a bar to filter"
            data={biomarkerData} selected={filters.biomarkers ?? []} baseColor="#f43f5e" selectedColor="#be123c" onSelect={(v) => toggleFilter('biomarkers', v)} />
          <TrendLineChart title="Biomarker Trend by Year" subtitle="Publications per year — top 6 biomarkers" data={biomarkerTrend.rows} keys={biomarkerTrend.keys} />

          <DistributionBarChart title="Cancer Type Distribution" subtitle="Publications per cancer category — click a bar to filter"
            data={cancerData} selected={filters.cancers ?? []} baseColor="#10b981" selectedColor="#047857" yWidth={110} onSelect={(v) => toggleFilter('cancers', v)} />
          <TrendLineChart title="Cancer Type Trend by Year" subtitle="Publications per year — top 6 cancer types" data={cancerTrend.rows} keys={cancerTrend.keys} />

          <DistributionBarChart title="Top Journals" subtitle="Journals these NCT-linked papers appear in"
            data={journalData} selected={filters.conferences ?? []} baseColor="#0ea5e9" yWidth={140} onSelect={(v) => toggleFilter('conferences', v)} />
          <DistributionBarChart title="Publication Type" subtitle="RCT / Phase / Review … — click to filter"
            data={ptypeData} selected={filters.presentationKinds ?? []} baseColor="#6366f1" yWidth={120} onSelect={(v) => toggleFilter('presentationKinds', v)} />

          <DistributionBarChart title="Top Companies" subtitle="Industry involvement (author affiliations) — click a bar to filter"
            data={companyData} selected={filters.companies ?? []} yWidth={120} onSelect={(v) => toggleFilter('companies', v)} />
          <DistributionBarChart title="Top Institutions" subtitle="Corresponding-author institution — click a bar to filter"
            data={institutionData} selected={filters.institutions ?? []} baseColor="#6366f1" selectedColor="#4338ca" yWidth={150} onSelect={(v) => toggleFilter('institutions', v)} />
          <DistributionBarChart title="Top Countries" subtitle="Corresponding-author country" data={countryData} baseColor="#0ea5e9" yWidth={120} />
          <ChartCard title="Years" subtitle="Coverage" height={320}>
            <div className="h-full flex flex-col items-center justify-center gap-1 text-center">
              <span className="text-4xl font-bold text-slate-800">{stats.datasets}</span>
              <span className="text-xs text-slate-400">journal-years in view</span>
            </div>
          </ChartCard>
        </div>
      </div>
    </div>
  )
}
