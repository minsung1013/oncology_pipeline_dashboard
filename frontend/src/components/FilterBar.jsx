export default function FilterBar({ options, filters, onChange }) {
  const { cancerCategories, modalities } = options

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

  return (
    <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap gap-x-6 gap-y-3 items-center">
      {/* 키워드 검색 */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">검색</span>
        <input
          type="text"
          value={filters.keyword}
          onChange={(e) => set('keyword', e.target.value)}
          placeholder="약물명, 회사, 타겟..."
          className="border border-slate-300 rounded px-2 py-1 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      {/* 암종 */}
      <MultiSelect
        label="암종"
        options={cancerCategories}
        selected={filters.cancerCategories}
        onToggle={(v) => toggle('cancerCategories', v)}
        onClear={() => set('cancerCategories', [])}
      />

      {/* 모달리티 */}
      <MultiSelect
        label="모달리티"
        options={modalities}
        selected={filters.modalities}
        onToggle={(v) => toggle('modalities', v)}
        onClear={() => set('modalities', [])}
      />

      {/* CDx 기회 */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">CDx 기회</span>
        <select
          value={filters.cdxLevel}
          onChange={(e) => set('cdxLevel', e.target.value)}
          className="border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">전체</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* 파트너십 */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">파트너십</span>
        <select
          value={filters.partnershipStatus}
          onChange={(e) => set('partnershipStatus', e.target.value)}
          className="border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">전체</option>
          <option value="solo">Solo</option>
          <option value="partnered">Partnered</option>
        </select>
      </div>

      {/* 수동 검토 토글 */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={filters.needsReview}
          onChange={(e) => set('needsReview', e.target.checked)}
          className="w-4 h-4 accent-orange-500"
        />
        <span className="text-sm text-slate-600">수동 검토 필요</span>
      </label>

      {/* 필터 초기화 */}
      <button
        onClick={() =>
          onChange({
            cancerCategories: [],
            modalities: [],
            cdxLevel: 'all',
            partnershipStatus: 'all',
            needsReview: false,
            keyword: '',
          })
        }
        className="ml-auto text-xs text-slate-400 hover:text-slate-600 underline"
      >
        초기화
      </button>
    </div>
  )
}

function MultiSelect({ label, options, selected, onToggle, onClear }) {
  return (
    <div className="relative group">
      <button className="flex items-center gap-1 border border-slate-300 rounded px-2 py-1 text-sm bg-white hover:bg-slate-50">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
        {selected.length > 0 && (
          <span className="bg-blue-100 text-blue-700 text-xs font-semibold rounded-full px-1.5">
            {selected.length}
          </span>
        )}
        <span className="text-slate-400 ml-1">▾</span>
      </button>
      <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded shadow-lg z-20 min-w-48 max-h-64 overflow-y-auto hidden group-focus-within:block group-hover:block">
        {selected.length > 0 && (
          <button
            onClick={onClear}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-50 border-b border-slate-100"
          >
            전체 해제
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
            <span className="text-sm text-slate-700">{opt}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
