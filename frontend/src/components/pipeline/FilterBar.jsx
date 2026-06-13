import { useState } from 'react'

const PHASE_LABELS = {
  EARLY_PHASE1: 'Early Phase 1',
  PHASE1:       'Phase 1',
  PHASE2:       'Phase 2',
  PHASE3:       'Phase 3',
  PHASE4:       'Phase 4',
  NA:           'N/A',
}

const STATUS_LABELS = {
  RECRUITING:              'Recruiting',
  ACTIVE_NOT_RECRUITING:   'Active (not recruiting)',
  NOT_YET_RECRUITING:      'Not yet recruiting',
  ENROLLING_BY_INVITATION: 'By invitation',
  COMPLETED:               'Completed',
  TERMINATED:              'Terminated',
  WITHDRAWN:               'Withdrawn',
  SUSPENDED:               'Suspended',
  UNKNOWN:                 'Unknown',
}

export default function FilterBar({ options, filters, onChange }) {
  const {
    cancerCategories, modalities, phases, overallStatuses,
    companies = [], targets = [], biomarkers = [], startYears, completionYears,
  } = options

  function toggle(key, value) {
    const current = filters[key]
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    onChange({ ...filters, [key]: next })
  }

  function set(key, value) {
    onChange({ ...filters, [key]: value })
  }

  const activeCount = [
    filters.cancerCategories.length,
    filters.modalities.length,
    filters.phases.length,
    filters.overallStatuses.length,
    (filters.companies?.length ?? 0),
    (filters.targets?.length ?? 0),
    (filters.biomarkers?.length ?? 0),
    filters.partnershipStatus !== 'all' ? 1 : 0,
    filters.regimen !== 'all' ? 1 : 0,
    filters.needsReview ? 1 : 0,
    filters.startYear.from !== 'all' || filters.startYear.to !== 'all' ? 1 : 0,
    filters.completionYear.from !== 'all' || filters.completionYear.to !== 'all' ? 1 : 0,
    filters.keyword ? 1 : 0,
  ].reduce((a, b) => a + b, 0)

  return (
    <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap gap-x-5 gap-y-2 items-center text-sm">

      {/* Keyword search */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Search</span>
        <input
          type="text"
          value={filters.keyword}
          onChange={(e) => set('keyword', e.target.value)}
          placeholder="Drug, company, target, MoA..."
          className="border border-slate-300 rounded px-2 py-1 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      <Divider />

      {/* Indication */}
      <MultiSelect
        label="Indication"
        options={cancerCategories}
        selected={filters.cancerCategories}
        onToggle={(v) => toggle('cancerCategories', v)}
        onClear={() => set('cancerCategories', [])}
      />

      {/* Modality */}
      <MultiSelect
        label="Modality"
        options={modalities}
        selected={filters.modalities}
        onToggle={(v) => toggle('modalities', v)}
        onClear={() => set('modalities', [])}
      />

      {/* Phase */}
      <MultiSelect
        label="Phase"
        options={phases}
        selected={filters.phases}
        onToggle={(v) => toggle('phases', v)}
        onClear={() => set('phases', [])}
        renderOption={(opt) => PHASE_LABELS[opt] ?? opt}
      />

      {/* Status */}
      <MultiSelect
        label="Status"
        options={overallStatuses}
        selected={filters.overallStatuses}
        onToggle={(v) => toggle('overallStatuses', v)}
        onClear={() => set('overallStatuses', [])}
        renderOption={(opt) => STATUS_LABELS[opt] ?? opt}
      />

      {/* Company (searchable — 6,000+) */}
      <MultiSelect
        label="Company"
        options={companies}
        selected={filters.companies ?? []}
        onToggle={(v) => toggle('companies', v)}
        onClear={() => set('companies', [])}
        searchable
      />

      {/* Target */}
      <MultiSelect
        label="Target"
        options={targets}
        selected={filters.targets ?? []}
        onToggle={(v) => toggle('targets', v)}
        onClear={() => set('targets', [])}
        searchable
      />

      {/* Biomarker */}
      <MultiSelect
        label="Biomarker"
        options={biomarkers}
        selected={filters.biomarkers ?? []}
        onToggle={(v) => toggle('biomarkers', v)}
        onClear={() => set('biomarkers', [])}
        searchable
      />

      {/* Partnership */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Partnership</span>
        <select
          value={filters.partnershipStatus}
          onChange={(e) => set('partnershipStatus', e.target.value)}
          className="border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">All</option>
          <option value="solo">Solo</option>
          <option value="partnered">Partnered</option>
        </select>
      </div>

      {/* Regimen (mono / combo) */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Regimen</span>
        <select
          value={filters.regimen}
          onChange={(e) => set('regimen', e.target.value)}
          className="border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">All</option>
          <option value="mono">Monotherapy</option>
          <option value="combo">Combination</option>
        </select>
      </div>

      <Divider />

      {/* Start Year range */}
      <div className="flex items-center gap-1">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Start</span>
        <YearRangeSelect
          years={startYears}
          value={filters.startYear}
          onChange={(v) => set('startYear', v)}
        />
      </div>

      {/* Completion Year range */}
      <div className="flex items-center gap-1">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Completion</span>
        <YearRangeSelect
          years={completionYears}
          value={filters.completionYear}
          onChange={(v) => set('completionYear', v)}
        />
      </div>

      <Divider />

      {/* Unknown target toggle */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={filters.needsReview}
          onChange={(e) => set('needsReview', e.target.checked)}
          className="w-4 h-4 accent-orange-500"
        />
        <span className="text-slate-600">Unknown target only</span>
      </label>

      {/* Clear filters */}
      {activeCount > 0 && (
        <button
          onClick={() =>
            onChange({
              cancerCategories: [],
              modalities: [],
              phases: [],
              overallStatuses: [],
              companies: [],
              targets: [],
              biomarkers: [],
              partnershipStatus: 'all',
              regimen: 'all',
              needsReview: false,
              startYear: { from: 'all', to: 'all' },
              completionYear: { from: 'all', to: 'all' },
              keyword: '',
            })
          }
          className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition-colors"
        >
          <span className="bg-slate-200 text-slate-600 rounded-full px-1.5 py-0.5 font-semibold text-xs">{activeCount}</span>
          Clear filters
        </button>
      )}
    </div>
  )
}

function YearRangeSelect({ years, value, onChange }) {
  const cls = "border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
  return (
    <div className="flex items-center gap-1">
      <select
        value={value.from}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
        className={cls}
      >
        <option value="all">From</option>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      <span className="text-slate-400 text-xs">–</span>
      <select
        value={value.to}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
        className={cls}
      >
        <option value="all">To</option>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  )
}

function Divider() {
  return <span className="text-slate-200 text-lg select-none">|</span>
}

function MultiSelect({ label, options, selected, onToggle, onClear, renderOption, searchable }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const render = renderOption ?? ((v) => v)

  const shown = searchable
    ? (query.trim()
        ? options.filter((o) => String(o).toLowerCase().includes(query.trim().toLowerCase()))
        : options
      ).slice(0, 200)
    : options

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 border rounded px-2 py-1 text-sm transition-colors ${
          selected.length > 0
            ? 'border-blue-400 bg-blue-50'
            : 'border-slate-300 bg-white hover:bg-slate-50'
        }`}
      >
        <span className={`text-xs font-semibold uppercase tracking-wide ${selected.length > 0 ? 'text-blue-600' : 'text-slate-400'}`}>
          {label}
        </span>
        {selected.length > 0 && (
          <span className="bg-blue-500 text-white text-xs font-semibold rounded-full px-1.5">
            {selected.length}
          </span>
        )}
        <span className="text-slate-400 ml-1">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded shadow-lg z-20 min-w-52 max-h-72 overflow-y-auto">
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
            {selected.length > 0 && (
              <button
                onClick={() => { onClear(); }}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-50 border-b border-slate-100"
              >
                Clear all
              </button>
            )}
            {shown.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-400">No matches</div>
            )}
            {shown.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => onToggle(opt)}
                  className="w-3.5 h-3.5 accent-blue-500"
                />
                <span className="text-sm text-slate-700 truncate">{render(opt)}</span>
              </label>
            ))}
            {searchable && query.trim() === '' && options.length > 200 && (
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
