import { useState, useMemo } from 'react'
import { phaseLabel } from '../../utils/visualizeAggregations'

// 다중선택 드롭다운. searchable=true면 검색창(회사 6,000개 대응).
function MultiSelect({
  label, options, selected, onChange,
  searchable = false, renderLabel = (v) => v, width = 'w-56',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!searchable) return options
    const q = query.trim().toLowerCase()
    const base = q ? options.filter((o) => o.toLowerCase().includes(q)) : options
    return base.slice(0, 200)
  }, [options, query, searchable])

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
          <div className={`absolute top-full left-0 mt-1 z-20 bg-white border border-slate-200 rounded shadow-lg ${width}`}>
            {searchable && (
              <div className="p-2 border-b border-slate-100">
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
                onClick={() => onChange([])}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-50 border-b border-slate-100"
              >
                Clear ({selected.length})
              </button>
            )}
            <div className="max-h-60 overflow-auto">
              {filtered.length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-400">No matches</div>
              )}
              {filtered.map((opt) => (
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
                  <span className="text-slate-700 truncate">{renderLabel(opt)}</span>
                </label>
              ))}
              {searchable && query.trim() === '' && options.length > 200 && (
                <div className="px-3 py-1.5 text-xs text-slate-400 italic">
                  Showing first 200 — type to search all {options.length.toLocaleString()}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function VisualizeFilterBar({ options, filters, onChange, topN, onTopNChange }) {
  const set = (key, value) => onChange({ ...filters, [key]: value })

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <MultiSelect
        label="Company" searchable width="w-72"
        options={options.companies}
        selected={filters.companies}
        onChange={(v) => set('companies', v)}
      />
      <MultiSelect
        label="Cancer" searchable
        options={options.cancerCategories}
        selected={filters.cancers}
        onChange={(v) => set('cancers', v)}
      />
      <MultiSelect
        label="Phase"
        options={options.phases}
        selected={filters.phases}
        onChange={(v) => set('phases', v)}
        renderLabel={phaseLabel}
      />
      <MultiSelect
        label="Modality"
        options={options.modalities}
        selected={filters.modalities}
        onChange={(v) => set('modalities', v)}
      />
      <MultiSelect
        label="Target" searchable
        options={options.targets}
        selected={filters.targets}
        onChange={(v) => set('targets', v)}
      />
      <MultiSelect
        label="Biomarker" searchable
        options={options.biomarkers}
        selected={filters.biomarkers}
        onChange={(v) => set('biomarkers', v)}
      />

      {/* Start year range */}
      <div className="flex items-center gap-1 text-xs text-slate-500">
        <span className="font-semibold uppercase tracking-wide text-slate-400">Start</span>
        <select
          value={filters.startYear.from}
          onChange={(e) => set('startYear', { ...filters.startYear, from: e.target.value })}
          className="border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:border-blue-400"
        >
          <option value="all">From</option>
          {options.startYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <span className="text-slate-300">–</span>
        <select
          value={filters.startYear.to}
          onChange={(e) => set('startYear', { ...filters.startYear, to: e.target.value })}
          className="border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:border-blue-400"
        >
          <option value="all">To</option>
          {options.startYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span>Top N</span>
        <select
          value={topN}
          onChange={(e) => onTopNChange(Number(e.target.value))}
          className="border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
        >
          {[5, 10, 15, 20, 30].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
