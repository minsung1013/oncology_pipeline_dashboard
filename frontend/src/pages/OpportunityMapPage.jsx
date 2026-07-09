import { useState, useEffect, useMemo } from 'react'
import DrugFilterBar from '../components/common/DrugFilterBar'
import TargetOpportunityMap from '../components/visualize/TargetOpportunityMap'
import { statusLabel } from '../components/visualize/statusMeta'
import { filterAbstractsForVisualize, phaseLabel } from '../utils/visualizeAggregations'
import { getDrugFilterOptions, applyDrugFilters, DRUG_FILTER_DEFAULT } from '../utils/drugFilters'
import { invertCanon } from '../utils/maturityAggregations'
import {
  buildOpportunityRows, applyRecency, flagEmerging, EMERGE_DEFAULTS, HALFLIFE_DEFAULT,
} from '../utils/opportunityAggregations'
import { getShared, setShared, getTabState, setTabState } from '../utils/filterStore'
import {
  getPipeline, getAbstractIndex, loadAbstractFiles, getMaturityAssets,
  getPublicationIndex, loadPublicationFiles,
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

export default function OpportunityMapPage() {
  const [data, setData] = useState(null)
  const [allAbstracts, setAllAbstracts] = useState(null)
  const [allPubs, setAllPubs] = useState(null)
  const [assets, setAssets] = useState(null)
  const [error, setError] = useState(null)
  const [filters, setFiltersState] = useState(getShared)
  const [thr, setThrState] = useState(() => ({ ...EMERGE_DEFAULTS, ...(getTabState('opportunity')?.thr ?? {}) }))
  const [halfLife, setHalfLifeState] = useState(() => getTabState('opportunity')?.halfLife ?? HALFLIFE_DEFAULT)

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
  function setThr(patch) {
    setThrState((prev) => {
      const next = { ...prev, ...patch }
      setTabState('opportunity', { ...getTabState('opportunity'), thr: next })
      return next
    })
  }
  function setHalfLife(v) {
    setHalfLifeState(v)
    setTabState('opportunity', { ...getTabState('opportunity'), halfLife: v })
  }

  useEffect(() => {
    getPipeline().then(setData).catch((e) => setError(e.message))
    getMaturityAssets().then(setAssets).catch(() => setAssets({ drugTargets: {}, targetCanon: {} }))
    getAbstractIndex()
      .then((idx) => loadAbstractFiles(idx))
      .then(setAllAbstracts)
      .catch(() => setAllAbstracts([]))
    // 논문: 최근 연도만 로드(오래된 논문은 최신성·추세에 무의미, 비용 절감)
    getPublicationIndex()
      .then((idx) => {
        const maxY = Math.max(...idx.map((m) => m.year).filter(Boolean), 0)
        return loadPublicationFiles(idx.filter((m) => m.year && m.year >= maxY - 6))
      })
      .then(setAllPubs)
      .catch(() => setAllPubs([]))
  }, [])

  const allDrugs = useMemo(() => data?.drugs ?? [], [data])
  const options = useMemo(() => getDrugFilterOptions(allDrugs), [allDrugs])
  const drugs = useMemo(() => applyDrugFilters(allDrugs, filters), [allDrugs, filters])
  const filteredAbstracts = useMemo(
    () => (allAbstracts ? filterAbstractsForVisualize(allAbstracts, filters) : null),
    [allAbstracts, filters],
  )
  const filteredPubs = useMemo(
    () => (allPubs ? filterAbstractsForVisualize(allPubs, filters) : null),
    [allPubs, filters],
  )
  // 원본 지표는 데이터/필터가 바뀔 때만 재계산 → 슬라이더(반감기·임계값)는 저렴한 후처리로
  const baseRows = useMemo(
    () => buildOpportunityRows(drugs, filteredAbstracts, filteredPubs, assets ?? {}),
    [drugs, filteredAbstracts, filteredPubs, assets],
  )
  const recencyRows = useMemo(() => applyRecency(baseRows, { halfLife }), [baseRows, halfLife])
  const rows = useMemo(() => flagEmerging(recencyRows, thr), [recencyRows, thr])
  const emerging = useMemo(
    () => rows.filter((r) => r.emerging).sort((a, b) => b.recent * b.growth_ratio - a.recent * a.growth_ratio),
    [rows],
  )

  const invCanon = useMemo(() => invertCanon(assets?.targetCanon ?? {}), [assets])
  const targetSet = new Set(filters.targets)
  const rawsOf = (canonName) => invCanon[canonName] ?? [canonName]
  const selectedCanon = useMemo(
    () => rows.filter((r) => rawsOf(r.target).some((raw) => targetSet.has(raw))).map((r) => r.target),
    [rows, filters.targets], // eslint-disable-line react-hooks/exhaustive-deps
  )
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
  const yearChipLabel = `${filters.startYear.from === 'all' ? '…' : filters.startYear.from}–${filters.startYear.to === 'all' ? '…' : filters.startYear.to}`

  if (error) return <div className="flex items-center justify-center h-full text-red-500">Failed to load data: {error}</div>
  if (!data) return <div className="flex items-center justify-center h-full text-slate-400 text-sm">Loading pipeline…</div>

  const preLoading = allAbstracts === null || allPubs === null
  const summary = `${emerging.length} emerging · ${rows.filter((r) => r.size_total > 0).length} targets`

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-slate-200 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-base font-bold text-slate-800 leading-none">Target Opportunity Map</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {summary}{preLoading && <span className="text-slate-300"> · 초록·논문 로딩…</span>}
            </p>
          </div>
        </div>
        <DrugFilterBar
          options={options}
          filters={filters}
          onChange={setFilters}
          extras={
            <div className="flex items-center gap-4 text-xs text-slate-600 flex-wrap">
              <label className="flex items-center gap-1.5" title="최근 2년 초록 수 하한">
                <span className="text-slate-500">최근2년 초록 ≥</span>
                <input type="range" min="0" max="20" step="1" value={thr.minRecent}
                  onChange={(e) => setThr({ minRecent: Number(e.target.value) })} className="w-20" />
                <span className="font-semibold w-4 tabular-nums">{thr.minRecent}</span>
              </label>
              <label className="flex items-center gap-1.5" title="성장비(최근2년/과거2년) 하한">
                <span className="text-slate-500">성장비 ≥</span>
                <input type="range" min="1" max="3" step="0.1" value={thr.minGrowth}
                  onChange={(e) => setThr({ minGrowth: Number(e.target.value) })} className="w-20" />
                <span className="font-semibold w-7 tabular-nums">{thr.minGrowth.toFixed(1)}×</span>
              </label>
              <label className="flex items-center gap-1.5" title="임상 성숙도 상한(이하만 '부상')">
                <span className="text-slate-500">성숙도 ≤</span>
                <input type="range" min="0.3" max="4" step="0.1" value={thr.maxMaturity}
                  onChange={(e) => setThr({ maxMaturity: Number(e.target.value) })} className="w-20" />
                <span className="font-semibold w-8 tabular-nums">{thr.maxMaturity.toFixed(1)}</span>
              </label>
              <label className="flex items-center gap-1.5" title="y축 최신 가중 반감기(작을수록 최신 초록만 강조)">
                <span className="text-slate-500">반감기</span>
                <input type="range" min="0.5" max="4" step="0.5" value={halfLife}
                  onChange={(e) => setHalfLife(Number(e.target.value))} className="w-20" />
                <span className="font-semibold w-8 tabular-nums">{halfLife}y</span>
              </label>
              <button onClick={() => { setThr(EMERGE_DEFAULTS); setHalfLife(HALFLIFE_DEFAULT) }} className="text-slate-400 hover:text-slate-600 underline">기본값</button>
            </div>
          }
        />
        {hasActive && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {activeChips.map(({ key, value }) => (
              <button key={`${key}:${value}`} onClick={() => toggleFilter(key, value)}
                className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100" title="Remove filter">
                <span className="text-blue-400">{CHIP_META[key].label}:</span>
                {CHIP_META[key].render(value)}<span className="text-blue-400">✕</span>
              </button>
            ))}
            {yearActive && (
              <button onClick={() => setFilters((prev) => ({ ...prev, startYear: { from: 'all', to: 'all' } }))}
                className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100" title="Remove filter">
                <span className="text-blue-400">Start:</span>{yearChipLabel}<span className="text-blue-400">✕</span>
              </button>
            )}
            <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-xs text-slate-400 hover:text-slate-600 ml-1">Clear all</button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <p className="text-xs text-slate-500 leading-relaxed">
          <b>x</b>=임상 성숙도(단계 가중 0.3~4 × 진행상태[완료↑·중단↓]의 <b>평균</b>) · <b>y</b>=<b>최신성</b>(임상·초록·논문 발표의 연도 시간감쇠 평균, 1=최근) ·
          점 크기=<b>총 발표 수</b>(임상+초록+논문) · 색=성장비(<span className="text-blue-600">파랑=식음</span>→<span className="text-red-600">빨강=뜸</span>) ·
          <b className="text-red-600"> 빨강 테두리=부상</b>. 왼쪽 위 핑크 = 최신·미성숙 화이트스페이스. 점/행 클릭 시 해당 타깃으로 필터.
        </p>

        <TargetOpportunityMap rows={rows} selected={selectedCanon} onSelect={toggleTarget} />

        <div>
          <h3 className="text-sm font-bold text-slate-700 mb-1">부상 타깃 <span className="text-slate-400 font-normal">({emerging.length}) — 최신·상승 · 임상 미성숙</span></h3>
          <div className="overflow-auto border border-slate-200 rounded">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr className="text-right">
                  <th className="px-2 py-1 text-left">Target</th>
                  <th className="px-2 py-1" title="임상 성숙도(단계×상태 평균, x축)">성숙도</th>
                  <th className="px-2 py-1" title="최신성(y축)">최신성</th>
                  <th className="px-2 py-1" title="총 발표 수(버블 크기)">총</th>
                  <th className="px-2 py-1" title="임상 진행/완료/중단">임상(진/완/중)</th>
                  <th className="px-2 py-1">초록</th>
                  <th className="px-2 py-1">논문</th>
                  <th className="px-2 py-1">최근2년</th>
                  <th className="px-2 py-1">성장</th>
                  <th className="px-2 py-1">최고단계</th>
                </tr>
              </thead>
              <tbody>
                {emerging.map((r) => {
                  const sel = selectedCanon.includes(r.target)
                  return (
                    <tr key={r.target} onClick={() => toggleTarget(r.target)}
                      className={`text-right cursor-pointer border-t border-slate-100 hover:bg-blue-50 ${sel ? 'bg-blue-50' : ''}`}>
                      <td className="px-2 py-1 text-left font-medium text-slate-700">{r.target}</td>
                      <td className="px-2 py-1 tabular-nums font-semibold text-slate-700">{r.clin_maturity}</td>
                      <td className="px-2 py-1 tabular-nums">{r.recency}</td>
                      <td className="px-2 py-1 tabular-nums font-semibold">{r.size_total}</td>
                      <td className="px-2 py-1 tabular-nums text-slate-500">{r.clin_ongoing}/{r.clin_completed}/{r.clin_stopped}</td>
                      <td className="px-2 py-1 tabular-nums">{r.abstract_count}</td>
                      <td className="px-2 py-1 tabular-nums">{r.pub_count}</td>
                      <td className="px-2 py-1 tabular-nums">{r.recent}</td>
                      <td className="px-2 py-1 tabular-nums font-semibold text-red-600">{r.growth_ratio}×</td>
                      <td className="px-2 py-1">{r.max_phase}</td>
                    </tr>
                  )
                })}
                {emerging.length === 0 && (
                  <tr><td colSpan="10" className="px-2 py-4 text-center text-slate-400">조건에 맞는 부상 타깃 없음 — 임계값을 완화하세요.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
