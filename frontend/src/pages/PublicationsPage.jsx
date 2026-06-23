import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import AbstractTable from '../components/conferences/AbstractTable'
import ConferenceFilterBar from '../components/conferences/ConferenceFilterBar'
import ConferenceActiveChips from '../components/conferences/ConferenceActiveChips'
import { applyAbstractFilters, getAbstractFilterOptions } from '../utils/abstractFilters'
import {
  buildPublicationFilters, setPublicationFilter, clearedPublicationFilters,
  publicationFilterActive, anyPublicationFilter,
} from '../utils/publicationFilters'
import { nctOnlyFilters } from '../utils/conferenceFilters'
import { getPublicationIndex, loadPublicationFiles } from '../utils/dataSource'

// 퍼블리케이션 manifest는 연도별(저널 혼합). 검색 활성 시 전 연도, 아니면 최신 연도.
function neededItems(index, filters, searchActive) {
  if (!index?.length) return []
  const allYears = [...new Set(index.map((m) => m.year))]
  const years = filters.years.length
    ? filters.years.map(Number)
    : (searchActive ? allYears : [Math.max(...allYears)])
  return index.filter((m) => years.includes(m.year))
}

export default function PublicationsPage() {
  const [index, setIndex] = useState(null)
  const [abstracts, setAbstracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filters, setFiltersState] = useState(buildPublicationFilters)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  function focusInPipeline(nct) {
    navigate(`/pipeline?nct=${encodeURIComponent(nct)}`)
  }

  const nctParam = searchParams.get('nct')
  const searchActive = publicationFilterActive(filters, nctParam)

  useEffect(() => {
    getPublicationIndex().then(setIndex).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!index) return
    const loadFilters = nctParam ? { years: [], conferences: [] } : filters
    const items = neededItems(index, loadFilters, searchActive)
    setLoading(true)
    loadPublicationFiles(items)
      .then((list) => { setAbstracts(list); setLoading(false) })
      .catch((e) => { setError(e.message); setLoading(false) })
  }, [index, filters.years, searchActive, nctParam])

  const filterOptions = useMemo(() => {
    const base = getAbstractFilterOptions(abstracts)
    if (index) base.years = [...new Set(index.map((m) => m.year))].sort((a, b) => b - a).map(String)
    return base
  }, [abstracts, index])

  const activeFilters = useMemo(
    () => (nctParam ? nctOnlyFilters(nctParam) : { ...filters, nctId: null }),
    [filters, nctParam],
  )
  const filtered = useMemo(() => applyAbstractFilters(abstracts, activeFilters), [abstracts, activeFilters])

  function setFilter(key, value) {
    setFiltersState((prev) => setPublicationFilter(prev, key, value))
  }
  function clearAll() {
    setFiltersState(clearedPublicationFilters())
    clearNct()
  }
  function clearNct() {
    setSearchParams({})
  }

  if (error) {
    return <div className="flex items-center justify-center h-full text-red-500">Failed to load publications: {error}</div>
  }
  if (!index) {
    return <div className="flex items-center justify-center h-full text-slate-400 text-sm">Loading publications…</div>
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
      <div className="bg-white border-b border-slate-200 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-base font-bold text-slate-800 leading-none">Journal Publications</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              NCT-linked oncology papers · {totalAvailable.toLocaleString()} total ·
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

        <div className="flex items-center gap-2 flex-wrap">
          {nctParam && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-amber-300 bg-amber-50 text-amber-800 font-medium">
              NCT: {nctParam}
              <button onClick={clearNct} className="ml-1 text-amber-500 hover:text-amber-700">✕</button>
            </div>
          )}
          {filters.authorName && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-violet-300 bg-violet-50 text-violet-800 font-medium">
              Author: {filters.authorName}
              <button onClick={() => setFilter('authorName', '')} className="ml-1 text-violet-500 hover:text-violet-700">✕</button>
            </div>
          )}
          <ConferenceFilterBar
            options={filterOptions}
            filters={filters}
            onChange={setFilter}
            onClear={clearAll}
            hasActive={anyPublicationFilter(filters, nctParam)}
          />
        </div>

        <ConferenceActiveChips filters={filters} onChange={setFilter} />
      </div>

      <AbstractTable
        abstracts={filtered}
        onAuthorClick={(name) => setFilter('authorName', name)}
        onNctClick={focusInPipeline}
      />
    </div>
  )
}
