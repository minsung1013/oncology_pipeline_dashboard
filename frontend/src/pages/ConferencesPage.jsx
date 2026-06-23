import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import AbstractTable from '../components/conferences/AbstractTable'
import { applyAbstractFilters, getAbstractFilterOptions } from '../utils/abstractFilters'
import { getShared, setShared, getTabState, setTabState } from '../utils/filterStore'
import { getAbstractIndex, loadAbstractFiles } from '../utils/dataSource'

// 현재 필터(학회·연도)로 로드할 manifest 파일 결정. 미선택 시 최신연도×전체학회.
function neededItems(index, filters) {
  if (!index?.length) return []
  const allYears = [...new Set(index.map((m) => m.year))]
  const allConfs = [...new Set(index.map((m) => m.conference))]
  const years = filters.years.length ? filters.years.map(Number) : [Math.max(...allYears)]
  const confs = filters.conferences.length ? filters.conferences : allConfs
  return index.filter((m) => years.includes(m.year) && confs.includes(m.conference))
}

// 공유 축(세 탭 공통) — cancer/phase/modality/company/target/biomarker/keyword.
// 없는 축(Source/Year/Country/Affiliation/Author 등)은 각 탭 고유로 자동 무시된다.
const SHARED_KEYS = new Set(['cancers', 'phases', 'modalities', 'companies', 'targets', 'biomarkers', 'keyword'])

const LOCAL_DEFAULT = {
  conferences: [],
  years: [],
  countries: [],
  affiliation: '',
  authorName: '',
  showEmbargoed: false,
}

function buildFilters() {
  const s = getShared()
  const l = getTabState('conferences') ?? LOCAL_DEFAULT
  return {
    cancers: s.cancers,
    phases: s.phases,
    modalities: s.modalities,
    companies: s.companies,
    targets: s.targets,
    biomarkers: s.biomarkers,
    keyword: s.keyword ?? '',
    conferences: l.conferences ?? [],
    years: l.years ?? [],
    countries: l.countries ?? [],
    affiliation: l.affiliation ?? '',
    authorName: l.authorName ?? '',
    showEmbargoed: l.showEmbargoed ?? false,
  }
}

function MultiSelect({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const toggle = (val) =>
    onChange(selected.includes(val) ? selected.filter((v) => v !== val) : [...selected, val])

  // 옵션이 많으면 검색창 노출 + 200개로 제한(렌더 폭주 방지)
  const searchable = options.length > 12
  const q = query.trim().toLowerCase()
  const shown = (q ? options.filter((o) => String(o).toLowerCase().includes(q)) : options).slice(0, 200)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors
          ${selected.length > 0
            ? 'border-blue-400 bg-blue-50 text-blue-700 font-semibold'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
          }`}
      >
        {label}
        {selected.length > 0 && (
          <span className="bg-blue-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs leading-none">
            {selected.length}
          </span>
        )}
        <span className="text-slate-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-slate-200 rounded shadow-lg min-w-44 max-h-60 overflow-auto">
            {searchable && (
              <div className="p-2 border-b border-slate-100 sticky top-0 bg-white">
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${label.toLowerCase()}…`}
                  className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
                />
              </div>
            )}
            {shown.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No matches</div>}
            {shown.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-xs"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  className="accent-blue-500"
                />
                <span className="text-slate-700 truncate">{opt}</span>
              </label>
            ))}
            {searchable && q === '' && options.length > 200 && (
              <div className="px-3 py-1.5 text-xs text-slate-400 italic">
                Showing first 200 — type to search all {options.length.toLocaleString()}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function ConferencesPage() {
  const [index, setIndex] = useState(null)
  const [abstracts, setAbstracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filters, setFiltersState] = useState(buildFilters)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  // NCT 클릭 → Pipeline 탭으로 이동, 해당 NCT로 키워드 필터(포커스)
  function focusInPipeline(nct) {
    const cur = getTabState('pipeline') ?? {}
    setTabState('pipeline', { ...cur, keyword: nct })
    navigate('/pipeline')
  }

  const nctParam = searchParams.get('nct')

  // manifest 로드
  useEffect(() => {
    getAbstractIndex().then(setIndex).catch((e) => setError(e.message))
  }, [])

  // 선택된 학회·연도에 맞는 파일을 lazy 로드 (캐시됨)
  useEffect(() => {
    if (!index) return
    const items = neededItems(index, filters)
    setLoading(true)
    loadAbstractFiles(items)
      .then((list) => { setAbstracts(list); setLoading(false) })
      .catch((e) => { setError(e.message); setLoading(false) })
  }, [index, filters.conferences, filters.years])

  // 학회·연도 옵션은 manifest에서(아직 로드 안 한 것도 선택 가능), 나머지는 로드된 데이터에서
  const filterOptions = useMemo(() => {
    const base = getAbstractFilterOptions(abstracts)
    if (index) {
      base.conferences = [...new Set(index.map((m) => m.conference))].sort()
      base.years = [...new Set(index.map((m) => m.year))].sort((a, b) => b - a).map(String)
    }
    return base
  }, [abstracts, index])

  const activeFilters = useMemo(
    () => ({ ...filters, nctId: nctParam || null }),
    [filters, nctParam],
  )

  const filtered = useMemo(
    () => applyAbstractFilters(abstracts, activeFilters),
    [abstracts, activeFilters],
  )

  function persistLocal(next) {
    setTabState('conferences', {
      conferences: next.conferences, years: next.years, countries: next.countries,
      affiliation: next.affiliation, authorName: next.authorName,
      showEmbargoed: next.showEmbargoed,
    })
  }

  function syncShared(next) {
    setShared({
      ...getShared(),
      cancers: next.cancers, phases: next.phases,
      modalities: next.modalities, companies: next.companies,
      targets: next.targets, biomarkers: next.biomarkers, keyword: next.keyword,
    })
  }

  function setFilter(key, value) {
    setFiltersState((prev) => {
      const next = { ...prev, [key]: value }
      if (SHARED_KEYS.has(key)) syncShared(next)
      else persistLocal(next)
      return next
    })
  }

  function clearAll() {
    const next = {
      cancers: [], phases: [], modalities: [], companies: [],
      targets: [], biomarkers: [], keyword: '', ...LOCAL_DEFAULT,
    }
    setFiltersState(next)
    syncShared(next)
    setTabState('conferences', LOCAL_DEFAULT)
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
  const loadedYears = [...new Set(abstracts.map((a) => `${a.conference} ${a.year}`))].sort().join(', ')

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
              {' '}loaded: {loadedYears || '—'}{loading && ' · loading…'}
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

          <MultiSelect
            label="Source"
            options={filterOptions.conferences}
            selected={filters.conferences}
            onChange={(v) => setFilter('conferences', v)}
          />

          <MultiSelect
            label="Year"
            options={filterOptions.years}
            selected={filters.years}
            onChange={(v) => setFilter('years', v)}
          />

          <MultiSelect
            label="Cancer"
            options={filterOptions.cancers}
            selected={filters.cancers}
            onChange={(v) => setFilter('cancers', v)}
          />

          <MultiSelect
            label="Phase"
            options={filterOptions.phases}
            selected={filters.phases}
            onChange={(v) => setFilter('phases', v)}
          />

          <MultiSelect
            label="Modality"
            options={filterOptions.modalities}
            selected={filters.modalities}
            onChange={(v) => setFilter('modalities', v)}
          />

          <MultiSelect
            label="Country"
            options={filterOptions.countries}
            selected={filters.countries}
            onChange={(v) => setFilter('countries', v)}
          />

          <MultiSelect
            label="Company"
            options={filterOptions.companies}
            selected={filters.companies}
            onChange={(v) => setFilter('companies', v)}
          />

          <MultiSelect
            label="Target"
            options={filterOptions.targets}
            selected={filters.targets}
            onChange={(v) => setFilter('targets', v)}
          />

          <MultiSelect
            label="Biomarker"
            options={filterOptions.biomarkers}
            selected={filters.biomarkers}
            onChange={(v) => setFilter('biomarkers', v)}
          />

          <input
            type="text"
            placeholder="Affiliation…"
            value={filters.affiliation}
            onChange={(e) => setFilter('affiliation', e.target.value)}
            className="border border-slate-200 rounded px-3 py-1.5 text-xs w-40 focus:outline-none focus:border-blue-400"
          />

          <input
            type="text"
            placeholder="Search title, author, target, NCT…"
            value={filters.keyword}
            onChange={(e) => setFilter('keyword', e.target.value)}
            className="border border-slate-200 rounded px-3 py-1.5 text-xs w-56 focus:outline-none focus:border-blue-400"
          />

          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer ml-auto">
            <input
              type="checkbox"
              checked={filters.showEmbargoed}
              onChange={(e) => setFilter('showEmbargoed', e.target.checked)}
              className="accent-blue-500"
            />
            Show embargoed
          </label>

          {(filters.conferences.length > 0 ||
            filters.years.length > 0 ||
            filters.cancers.length > 0 ||
            filters.phases.length > 0 ||
            filters.modalities.length > 0 ||
            filters.countries.length > 0 ||
            filters.companies.length > 0 ||
            filters.targets.length > 0 ||
            filters.biomarkers.length > 0 ||
            filters.affiliation ||
            filters.authorName ||
            filters.keyword ||
            nctParam) && (
            <button
              onClick={clearAll}
              className="text-xs text-slate-400 hover:text-slate-600 ml-1"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Active filter chips (선택 항목 표시 + 개별 제거) */}
        {(() => {
          const META = {
            conferences: 'Source', years: 'Year', cancers: 'Cancer',
            phases: 'Phase', modalities: 'Modality', countries: 'Country', companies: 'Company',
            targets: 'Target', biomarkers: 'Biomarker',
          }
          const chips = Object.entries(META).flatMap(([key, label]) =>
            (filters[key] || []).map((value) => ({ key, label, value })),
          )
          if (filters.affiliation) chips.push({ key: 'affiliation', label: 'Affiliation', value: filters.affiliation, text: true })
          if (filters.keyword) chips.push({ key: 'keyword', label: 'Search', value: filters.keyword, text: true })
          if (chips.length === 0) return null
          return (
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              {chips.map(({ key, label, value, text }) => (
                <button
                  key={`${key}:${value}`}
                  onClick={() =>
                    setFilter(key, text ? '' : (filters[key] || []).filter((v) => v !== value))
                  }
                  className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                  title="Remove filter"
                >
                  <span className="text-blue-400">{label}:</span>
                  {value}
                  <span className="text-blue-400">✕</span>
                </button>
              ))}
            </div>
          )
        })()}
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
