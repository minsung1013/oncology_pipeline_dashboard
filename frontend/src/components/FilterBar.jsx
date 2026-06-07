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
  const { cancerCategories, modalities, phases, overallStatuses, startYears, completionYears } = options

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
    filters.partnershipStatus !== 'all' ? 1 : 0,
    filters.needsReview ? 1 : 0,
    filters.startYear !== 'all' ? 1 : 0,
    filters.completionYear !== 'all' ? 1 : 0,
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

      <Divider />

      {/* Start Year */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Start</span>
        <select
          value={filters.startYear}
          onChange={(e) => set('startYear', e.target.value)}
          className="border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">All</option>
          {startYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* Completion Year */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Completion</span>
        <select
          value={filters.completionYear}
          onChange={(e) => set('completionYear', e.target.value)}
          className="border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">All</option>
          {completionYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
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
              partnershipStatus: 'all',
              needsReview: false,
              startYear: 'all',
              completionYear: 'all',
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

function Divider() {
  return <span className="text-slate-200 text-lg select-none">|</span>
}

function MultiSelect({ label, options, selected, onToggle, onClear, renderOption }) {
  const render = renderOption ?? ((v) => v)
  return (
    <div className="relative group">
      <button className="flex items-center gap-1 border border-slate-300 rounded px-2 py-1 text-sm bg-white hover:bg-slate-50">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</span>
        {selected.length > 0 && (
          <span className="bg-blue-100 text-blue-700 text-xs font-semibold rounded-full px-1.5">
            {selected.length}
          </span>
        )}
        <span className="text-slate-400 ml-1">▾</span>
      </button>
      <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded shadow-lg z-20 min-w-52 max-h-72 overflow-y-auto hidden group-focus-within:block group-hover:block">
        {selected.length > 0 && (
          <button
            onClick={onClear}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-50 border-b border-slate-100"
          >
            Clear all
          </button>
        )}
        {options.map((opt) => (
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
            <span className="text-sm text-slate-700">{render(opt)}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
