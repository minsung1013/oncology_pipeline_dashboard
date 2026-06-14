export default function CompanyList({ companies, selectedCompany, onSelect, onClose }) {
  if (companies.length === 0) {
    return (
      <div className="w-56 shrink-0 text-sm text-slate-400 px-4 py-6">
        No results
      </div>
    )
  }

  return (
    <div className="w-56 shrink-0 border-r border-slate-200 overflow-y-auto">
      <div className="sticky top-0 bg-slate-50 border-b border-slate-200 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Companies ({companies.length})
        </span>
        {onClose && (
          <button onClick={onClose} title="Collapse" className="text-slate-400 hover:text-slate-600 text-sm leading-none">
            ◀
          </button>
        )}
      </div>
      <ul>
        {companies.map(({ company, count }) => (
          <li key={company}>
            <button
              onClick={() => onSelect(company)}
              className={`w-full text-left px-3 py-2 flex items-center justify-between text-sm hover:bg-blue-50 transition-colors ${
                selectedCompany === company
                  ? 'bg-blue-50 text-blue-700 font-semibold border-r-2 border-blue-500'
                  : 'text-slate-700'
              }`}
            >
              <span className="truncate flex-1 mr-2">{company}</span>
              <span
                className={`text-xs font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                  selectedCompany === company
                    ? 'bg-blue-200 text-blue-800'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {count}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
