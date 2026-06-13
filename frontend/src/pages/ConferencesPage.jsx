import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import AbstractTable from '../components/conferences/AbstractTable'
import { applyAbstractFilters, getAbstractFilterOptions } from '../utils/abstractFilters'
import { getShared, setShared, getTabState, setTabState } from '../utils/filterStore'

const ABSTRACTS_URL =
  import.meta.env.VITE_ABSTRACTS_URL ??
  'https://raw.githubusercontent.com/minsung1013/oncology_pipeline_dashboard/main/data/parsed/abstracts_asco2026.json'

// cancer/phase/modality/company는 공유 축 (company는 정규 제약사명으로 통일), 나머지는 Conferences 고유
const SHARED_KEYS = new Set(['cancers', 'phases', 'modalities', 'companies'])

const LOCAL_DEFAULT = {
  conferences: [],
  years: [],
  countries: [],
  affiliation: '',
  authorName: '',
  keyword: '',
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
    conferences: l.conferences ?? [],
    years: l.years ?? [],
    countries: l.countries ?? [],
    affiliation: l.affiliation ?? '',
    authorName: l.authorName ?? '',
    keyword: l.keyword ?? '',
    showEmbargoed: l.showEmbargoed ?? false,
  }
}

function MultiSelect({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const toggle = (val) =>
    onChange(selected.includes(val) ? selected.filter((v) => v !== val) : [...selected, val])

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
            {options.map((opt) => (
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
                <span className="text-slate-700">{opt}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function ConferencesPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [filters, setFiltersState] = useState(buildFilters)
  const [searchParams, setSearchParams] = useSearchParams()

  const nctParam = searchParams.get('nct')

  useEffect(() => {
    fetch(ABSTRACTS_URL, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  const abstracts = data?.abstracts ?? []
  const metadata = data?.metadata

  const filterOptions = useMemo(() => getAbstractFilterOptions(abstracts), [abstracts])

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
      keyword: next.keyword, showEmbargoed: next.showEmbargoed,
    })
  }

  function setFilter(key, value) {
    setFiltersState((prev) => {
      const next = { ...prev, [key]: value }
      if (SHARED_KEYS.has(key)) {
        setShared({
          ...getShared(),
          cancers: next.cancers, phases: next.phases,
          modalities: next.modalities, companies: next.companies,
        })
      } else {
        persistLocal(next)
      }
      return next
    })
  }

  function clearAll() {
    const next = { cancers: [], phases: [], modalities: [], companies: [], ...LOCAL_DEFAULT }
    setFiltersState(next)
    setShared({ ...getShared(), cancers: [], phases: [], modalities: [], companies: [] })
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

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Loading ASCO 2026 abstracts…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-base font-bold text-slate-800 leading-none">
              ASCO 2026 Abstracts
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {metadata?.available?.toLocaleString()} available ·{' '}
              {metadata?.embargoed?.toLocaleString()} embargoed · Updated{' '}
              {metadata?.last_updated?.slice(0, 10)}
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{filtered.length.toLocaleString()}</span>
            {' '}of{' '}
            <span className="font-semibold text-slate-700">{abstracts.length.toLocaleString()}</span>
            {' '}abstracts
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
      </div>

      {/* Table */}
      <AbstractTable
        abstracts={filtered}
        onAuthorClick={(name) => setFilter('authorName', name)}
      />
    </div>
  )
}
