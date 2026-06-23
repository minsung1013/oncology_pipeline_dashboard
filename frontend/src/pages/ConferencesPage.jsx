import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import AbstractTable from '../components/conferences/AbstractTable'
import ConferenceFilterBar from '../components/conferences/ConferenceFilterBar'
import ConferenceActiveChips from '../components/conferences/ConferenceActiveChips'
import { applyAbstractFilters, getAbstractFilterOptions } from '../utils/abstractFilters'
import {
  buildConferenceFilters, setConferenceFilter, clearedConferenceFilters,
  conferenceFilterActive, anyConferenceFilter, nctOnlyFilters,
} from '../utils/conferenceFilters'
import { getAbstractIndex, loadAbstractFiles } from '../utils/dataSource'

// 로드할 manifest 파일 결정.
//  - 연도 미선택 + 검색/필터 없음 → 최신연도만 (기본 뷰, 빠름)
//  - 연도 미선택 + 검색/필터 활성 → 전 연도 로드 (검색이 전 연도에 걸리도록)
//  - 연도 선택 시 → 그 연도들
function neededItems(index, filters, searchActive) {
  if (!index?.length) return []
  const allYears = [...new Set(index.map((m) => m.year))]
  const allConfs = [...new Set(index.map((m) => m.conference))]
  const years = filters.years.length
    ? filters.years.map(Number)
    : (searchActive ? allYears : [Math.max(...allYears)])
  const confs = filters.conferences.length ? filters.conferences : allConfs
  return index.filter((m) => years.includes(m.year) && confs.includes(m.conference))
}

export default function ConferencesPage() {
  const [index, setIndex] = useState(null)
  const [abstracts, setAbstracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filters, setFiltersState] = useState(buildConferenceFilters)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  // NCT 클릭 → Pipeline 탭으로 이동, 해당 시험만 필터 (?nct= 파라미터)
  function focusInPipeline(nct) {
    navigate(`/pipeline?nct=${encodeURIComponent(nct)}`)
  }

  const nctParam = searchParams.get('nct')
  // 검색·필터 의도가 있으면 전 연도 로드 (그래야 다른 연도 결과도 검색됨)
  const searchActive = conferenceFilterActive(filters, nctParam)

  // manifest 로드
  useEffect(() => {
    getAbstractIndex().then(setIndex).catch((e) => setError(e.message))
  }, [])

  // 필요한 연도 파일을 lazy 로드 (캐시됨). 검색 활성 시 전 연도.
  useEffect(() => {
    if (!index) return
    const items = neededItems(index, filters, searchActive)
    setLoading(true)
    loadAbstractFiles(items)
      .then((list) => { setAbstracts(list); setLoading(false) })
      .catch((e) => { setError(e.message); setLoading(false) })
  }, [index, filters.conferences, filters.years, searchActive])

  // 학회·연도 옵션은 manifest에서(아직 로드 안 한 것도 선택 가능), 나머지는 로드된 데이터에서
  const filterOptions = useMemo(() => {
    const base = getAbstractFilterOptions(abstracts)
    if (index) {
      base.conferences = [...new Set(index.map((m) => m.conference))].sort()
      base.years = [...new Set(index.map((m) => m.year))].sort((a, b) => b - a).map(String)
    }
    return base
  }, [abstracts, index])

  // NCT로 넘어오면 해당 시험만 (다른 필터 무시), 아니면 일반 필터
  const activeFilters = useMemo(
    () => (nctParam ? nctOnlyFilters(nctParam) : { ...filters, nctId: null }),
    [filters, nctParam],
  )

  const filtered = useMemo(
    () => applyAbstractFilters(abstracts, activeFilters),
    [abstracts, activeFilters],
  )

  function setFilter(key, value) {
    setFiltersState((prev) => setConferenceFilter(prev, key, value))
  }

  function clearAll() {
    setFiltersState(clearedConferenceFilters())
    clearNct()
  }

  function clearNct() {
    setSearchParams({})
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500">
        Failed to load abstracts: {error}
      </div>
    )
  }

  if (!index) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Loading conference abstracts…
      </div>
    )
  }

  const totalAvailable = index.reduce((s, m) => s + m.count, 0)
  const loadedYearSet = [...new Set(abstracts.map((a) => a.year))].sort()
  const allYearsLoaded = loadedYearSet.length >= new Set(index.map((m) => m.year)).size
  const loadedYears = abstracts.length === 0
    ? '—'
    : allYearsLoaded
      ? `all years (${loadedYearSet[0]}–${loadedYearSet[loadedYearSet.length - 1]})`
      : loadedYearSet.join(', ')

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-base font-bold text-slate-800 leading-none">
              Conference Abstracts
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {index.length} datasets · {totalAvailable.toLocaleString()} abstracts total ·
              {' '}loaded: {loadedYears}{loading && ' · loading…'}
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{filtered.length.toLocaleString()}</span>
            {' '}of{' '}
            <span className="font-semibold text-slate-700">{abstracts.length.toLocaleString()}</span>
            {' '}loaded
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap">
          {nctParam && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-amber-300 bg-amber-50 text-amber-800 font-medium">
              NCT: {nctParam}
              <button
                onClick={clearNct}
                className="ml-1 text-amber-500 hover:text-amber-700"
              >
                ✕
              </button>
            </div>
          )}

          {filters.authorName && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-violet-300 bg-violet-50 text-violet-800 font-medium">
              Author: {filters.authorName}
              <button
                onClick={() => setFilter('authorName', '')}
                className="ml-1 text-violet-500 hover:text-violet-700"
              >
                ✕
              </button>
            </div>
          )}

          <ConferenceFilterBar
            options={filterOptions}
            filters={filters}
            onChange={setFilter}
            onClear={clearAll}
            hasActive={anyConferenceFilter(filters, nctParam)}
          />
        </div>

        {/* Active filter chips (모든 선택 항목 — 개별 ✕ 제거) */}
        <ConferenceActiveChips filters={filters} onChange={setFilter} />
      </div>

      {/* Table */}
      <AbstractTable
        abstracts={filtered}
        onAuthorClick={(name) => setFilter('authorName', name)}
        onNctClick={focusInPipeline}
      />
    </div>
  )
}
