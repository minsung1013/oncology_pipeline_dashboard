import { useState } from 'react'

// 앱 전역 공용 다중선택 드롭다운. 옵션이 많으면 검색창 + 200개 cap.
// onChange(nextArray)로 전체 선택값을 전달.
export default function FilterMultiSelect({
  label, options = [], selected = [], onChange, renderLabel = (v) => v, width = 'w-56',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const searchable = options.length > 12
  const q = query.trim().toLowerCase()
  const shown = (q ? options.filter((o) => String(o).toLowerCase().includes(q)) : options).slice(0, 200)
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
          <div className={`absolute top-full left-0 mt-1 z-20 bg-white border border-slate-200 rounded shadow-lg ${width} max-h-72 overflow-auto`}>
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
                onClick={() => onChange([])}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-50 border-b border-slate-100"
              >
                Clear ({selected.length})
              </button>
            )}
            {shown.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No matches</div>}
            {shown.map((opt) => (
              <label
                key={opt}
                title={String(renderLabel(opt))}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-xs"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  className="accent-blue-500 shrink-0"
                />
                <span className="text-slate-700 truncate">{renderLabel(opt)}</span>
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
