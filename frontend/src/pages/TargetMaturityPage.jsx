import { useState, useEffect, useMemo } from 'react'
import DrugFilterBar from '../components/common/DrugFilterBar'
import TargetMaturityChart from '../components/visualize/TargetMaturityChart'
import { statusLabel } from '../components/visualize/statusMeta'
import { filterAbstractsForVisualize, phaseLabel } from '../utils/visualizeAggregations'
import { getDrugFilterOptions, applyDrugFilters, DRUG_FILTER_DEFAULT } from '../utils/drugFilters'
import { buildMaturityRows, invertCanon } from '../utils/maturityAggregations'
import { getShared, setShared, getTabState, setTabState } from '../utils/filterStore'
import {
  getPipeline, getAbstractIndex, loadAbstractFiles, getMaturityAssets,
} from '../utils/dataSource'

const EMPTY_FILTERS = DRUG_FILTER_DEFAULT

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

export default function TargetMaturityPage() {
  const [data, setData] = useState(null)
  const [allAbstracts, setAllAbstracts] = useState(null)
  const [assets, setAssets] = useState(null)
  const [error, setError] = useState(null)
  const [filters, setFiltersState] = useState(getShared)
  const [topN, setTopNState] = useState(() => getTabState('maturity')?.topN ?? 100)

  // Visualize와 동일한 공유 축 → store.shared 동기화(탭 간 필터 유지)
  function setFilters(updater) {
    setFiltersState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
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
    setTabState('maturity', { topN: v })
  }

  useEffect(() => {
    getPipeline().then(setData).catch((e) => setError(e.message))
    getMaturityAssets().then(setAssets).catch(() => setAssets({ drugTargets: {}, targetCanon: {} }))
    // 전임상 레이어는 항상 초록 필요 → 전체 로드(캐시)
    getAbstractIndex()
      .then((idx) => loadAbstractFiles(idx))
      .then(setAllAbstracts)
      .catch(() => setAllAbstracts([]))
  }, [])

  const allDrugs = useMemo(() => data?.drugs ?? [], [data])
  const options = useMemo(() => getDrugFilterOptions(allDrugs), [allDrugs])
  const drugs = useMemo(() => applyDrugFilters(allDrugs, filters), [allDrugs, filters])
  const filteredAbstracts = useMemo(
    () => (allAbstracts ? filterAbstractsForVisualize(allAbstracts, filters) : null),
    [allAbstracts, filters],
  )
  const rows = useMemo(
    () => buildMaturityRows(drugs, filteredAbstracts, assets ?? {}),
    [drugs, filteredAbstracts, assets],
  )

  // canonical target → 활성 여부 (raw 변형 중 하나라도 필터에 있으면 활성)
  const invCanon = useMemo(() => invertCanon(assets?.targetCanon ?? {}), [assets])
  const targetSet = new Set(filters.targets)
  const rawsOf = (canonName) => invCanon[canonName] ?? [canonName]
  const selectedCanon = useMemo(
    () => rows.filter((r) => rawsOf(r.target).some((raw) => targetSet.has(raw))).map((r) => r.target),
    [rows, filters.targets], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // 막대(target) 클릭 → 해당 canonical 의 raw 변형들을 targets 필터에 토글
  const toggleTarget = (canonName) => {
    const raws = rawsOf(canonName)
    setFilters((prev) => {
      const cur = new Set(prev.targets)
      const active = raws.some((r) => cur.has(r))
      raws.forEach((r) => (active ? cur.delete(r) : cur.add(r)))
      return { ...prev, targets: [...cur] }
    })
  }
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

  if (error) {
    return <div className="flex items-center justify-center h-full text-red-500">Failed to load data: {error}</div>
  }
  if (!data) {
    return <div className="flex items-center justify-center h-full text-slate-400 text-sm">Loading pipeline…</div>
  }

  const nTargets = rows.filter((r) => r.total_activity > 0).length
  const preLoading = allAbstracts === null
  const summary = hasActive
    ? `${drugs.length.toLocaleString()} clinical programs · ${nTargets} targets — ${activeCount} filter${activeCount > 1 ? 's' : ''}`
    : `All — ${drugs.length.toLocaleString()} clinical programs · ${nTargets} targets`

  const yearChipLabel = `${filters.startYear.from === 'all' ? '…' : filters.startYear.from}–${filters.startYear.to === 'all' ? '…' : filters.startYear.to}`

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-slate-200 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-base font-bold text-slate-800 leading-none">Target Maturity</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {summary}
              {preLoading && <span className="text-slate-300"> · 전임상 초록 로딩…</span>}
            </p>
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
                {[30, 50, 100, 150, 300].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          }
        />
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
                <span className="text-blue-400">Start:</span>{yearChipLabel}<span className="text-blue-400">✕</span>
              </button>
            )}
            <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-xs text-slate-400 hover:text-slate-600 ml-1">
              Clear all
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3">
        <p className="text-xs text-slate-500 leading-relaxed">
          막대 길이 = 고유 약물(프로그램) 수 <b>(로그 스케일)</b> · 색 = 최고 개발 단계 구성 ·
          임상=ClinicalTrials.gov, 전임상=학회 초록서 언급된 실약물(세포주 제외). 막대 클릭 시 해당 타겟으로 필터.
          세그먼트 hover 시 진행/완료/중단 상세.
        </p>
        <TargetMaturityChart rows={rows} topN={topN} selected={selectedCanon} onSelect={toggleTarget} />
      </div>
    </div>
  )
}
