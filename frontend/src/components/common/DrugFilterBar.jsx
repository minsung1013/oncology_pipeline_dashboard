import { useState } from 'react'
import { phaseLabel } from '../../utils/visualizeAggregations'
import { statusLabel, STATUS_META } from '../visualize/statusMeta'
import { DRUG_FILTER_DEFAULT } from '../../utils/drugFilters'

// Pipeline·Visualize 공용 필터 바. 같은 약물 데이터셋 → 동일한 축·검색을 공유한다.
// 페이지 고유 컨트롤(Top N, Partnership 등)은 `extras` 슬롯으로 주입.

const STATUS_ORDER = STATUS_META.map((s) => s.key)

// 공유 다중선택 축 (options[key]가 선택지, filters[key]가 선택값)
const AXES = [
  { key: 'companies', label: 'Company', searchable: true },
  { key: 'drugs', label: 'Drug', searchable: true },
  { key: 'cancers', label: 'Indication', searchable: true },
  { key: 'modalities', label: 'Modality' },
  { key: 'phases', label: 'Phase', render: phaseLabel },
  { key: 'statuses', label: 'Status', render: statusLabel,
    sort: (a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b) },
  { key: 'targets', label: 'Target', searchable: true },
  { key: 'biomarkers', label: 'Biomarker', searchable: true },
]

export default function DrugFilterBar({ options, filters, onChange, extras = null, showCompletion = false }) {
  const set = (key, value) => onChange({ ...filters, [key]: value })
  const toggle = (key, value) => {
    const cur = filters[key] ?? []
    set(key, cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value])
  }

  const arrCount = AXES.reduce((n, a) => n + (filters[a.key]?.length ?? 0), 0)
  const activeCount =
    arrCount +
    (filters.keyword ? 1 : 0) +
    (filters.startYear?.from !== 'all' || filters.startYear?.to !== 'all' ? 1 : 0) +
    (filters.completionYear?.from !== 'all' || filters.completionYear?.to !== 'all' ? 1 : 0) +
    (filters.partnershipStatus && filters.partnershipStatus !== 'all' ? 1 : 0) +
    (filters.regimen && filters.regimen !== 'all' ? 1 : 0) +
    (filters.needsReview ? 1 : 0)

  return (
    <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap gap-x-4 gap-y-2 items-center text-sm">
      {/* Keyword search */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Search</span>
        <input
          type="text"
          value={filters.keyword ?? ''}
          onChange={(e) => set('keyword', e.target.value)}
          placeholder="Drug, company, target, MoA..."
          className="border border-slate-300 rounded px-2 py-1 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      <Divider />

      {AXES.map((a) => {
        const opts = a.sort ? [...(options[a.key] ?? [])].sort(a.sort) : (options[a.key] ?? [])
        return (
          <MultiSelect
            key={a.key}
            label={a.label}
            options={opts}
            selected={filters[a.key] ?? []}
            onToggle={(v) => toggle(a.key, v)}
            onClear={() => set(a.key, [])}
            searchable={a.searchable}
            renderOption={a.render}
          />
        )
      })}

      <Divider />

      {/* Start year range */}
      <div className="flex items-center gap-1">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Start</span>
        <YearRangeSelect years={options.startYears ?? []} value={filters.startYear} onChange={(v) => set('startYear', v)} />
      </div>

      {showCompletion && (
        <div className="flex items-center gap-1">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Completion</span>
          <YearRangeSelect years={options.completionYears ?? []} value={filters.completionYear} onChange={(v) => set('completionYear', v)} />
        </div>
      )}

      {extras && (
        <>
          <Divider />
          {extras}
        </>
      )}

      {activeCount > 0 && (
        <button
          onClick={() => onChange({ ...DRUG_FILTER_DEFAULT })}
          className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition-colors"
        >
          <span className="bg-slate-200 text-slate-600 rounded-full px-1.5 py-0.5 font-semibold text-xs">{activeCount}</span>
          Clear filters
        </button>
      )}
    </div>
  )
}

function YearRangeSelect({ years, value = { from: 'all', to: 'all' }, onChange }) {
  const cls = 'border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400'
  return (
    <div className="flex items-center gap-1">
      <select value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} className={cls}>
        <option value="all">From</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <span className="text-slate-400 text-xs">–</span>
      <select value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} className={cls}>
        <option value="all">To</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
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
          selected.length > 0 ? 'border-blue-400 bg-blue-50' : 'border-slate-300 bg-white hover:bg-slate-50'
        }`}
      >
        <span className={`text-xs font-semibold uppercase tracking-wide ${selected.length > 0 ? 'text-blue-600' : 'text-slate-400'}`}>
          {label}
        </span>
        {selected.length > 0 && (
          <span className="bg-blue-500 text-white text-xs font-semibold rounded-full px-1.5">{selected.length}</span>
        )}
        <span className="text-slate-400 ml-1">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded shadow-lg z-20 w-64 max-w-64 max-h-72 overflow-y-auto">
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
                onClick={onClear}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-50 border-b border-slate-100"
              >
                Clear all
              </button>
            )}
            {shown.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No matches</div>}
            {shown.map((opt) => (
              <label
                key={opt}
                title={String(render(opt))}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => onToggle(opt)}
                  className="w-3.5 h-3.5 accent-blue-500 shrink-0"
                />
                <span className="text-sm text-slate-700 truncate min-w-0">{render(opt)}</span>
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
