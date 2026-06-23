import { useState } from 'react'
import FilterMultiSelect from '../common/FilterMultiSelect'
import { phaseLabel } from '../../utils/visualizeAggregations'

const AXIS_KEYS = ['conferences', 'years', 'presentationKinds', 'cancers', 'phases',
  'modalities', 'countries', 'companies', 'targets', 'biomarkers']

// Conference 테이블 ↔ Visualize 공용 필터 바 (완전히 동일한 필터 셋).
// onChange(key, value): value는 해당 축의 새 전체값(배열/문자열/불리언).
export default function ConferenceFilterBar({ options, filters, onChange, onClear, hasActive, extras }) {
  const [barOpen, setBarOpen] = useState(false)
  const ms = (key, label, renderLabel) => (
    <FilterMultiSelect
      label={label}
      options={options[key] ?? []}
      selected={filters[key] ?? []}
      onChange={(v) => onChange(key, v)}
      renderLabel={renderLabel}
    />
  )
  const activeCount =
    AXIS_KEYS.reduce((n, k) => n + (filters[k]?.length ?? 0), 0) +
    (filters.affiliation ? 1 : 0) + (filters.keyword ? 1 : 0)

  return (
    <div className="w-full">
      {/* 모바일: 필터 접기 토글 */}
      <button
        onClick={() => setBarOpen((o) => !o)}
        className="md:hidden flex items-center gap-2 text-xs font-semibold text-slate-600 border border-slate-200 rounded px-3 py-1.5"
      >
        Filters
        {activeCount > 0 && <span className="bg-blue-500 text-white rounded-full px-1.5">{activeCount}</span>}
        <span className="text-slate-400">{barOpen ? '▲' : '▼'}</span>
      </button>

      <div className={`${barOpen ? 'flex' : 'hidden'} md:flex items-center gap-2 flex-wrap pt-2 md:pt-0`}>
      {ms('conferences', 'Source')}
      {ms('years', 'Year')}
      {ms('presentationKinds', 'Type')}
      {ms('cancers', 'Cancer')}
      {ms('phases', 'Phase', phaseLabel)}
      {ms('modalities', 'Modality')}
      {ms('countries', 'Country')}
      {ms('companies', 'Company')}
      {ms('targets', 'Target')}
      {ms('biomarkers', 'Biomarker')}

      <input
        type="text"
        placeholder="Affiliation…"
        value={filters.affiliation ?? ''}
        onChange={(e) => onChange('affiliation', e.target.value)}
        className="border border-slate-200 rounded px-3 py-1.5 text-xs w-36 focus:outline-none focus:border-blue-400"
      />
      <input
        type="text"
        placeholder="Search title, author, target, NCT…"
        value={filters.keyword ?? ''}
        onChange={(e) => onChange('keyword', e.target.value)}
        className="border border-slate-200 rounded px-3 py-1.5 text-xs w-56 focus:outline-none focus:border-blue-400"
      />

      <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
        <input
          type="checkbox"
          checked={filters.showEmbargoed ?? false}
          onChange={(e) => onChange('showEmbargoed', e.target.checked)}
          className="accent-blue-500"
        />
        Show embargoed
      </label>

      {extras}

      {hasActive && (
        <button onClick={onClear} className="text-xs text-slate-400 hover:text-slate-600 ml-1">
          Clear all
        </button>
      )}
      </div>
    </div>
  )
}
