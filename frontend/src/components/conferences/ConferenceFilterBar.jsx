import FilterMultiSelect from '../common/FilterMultiSelect'
import { phaseLabel } from '../../utils/visualizeAggregations'

// Conference 테이블 ↔ Visualize 공용 필터 바 (완전히 동일한 필터 셋).
// onChange(key, value): value는 해당 축의 새 전체값(배열/문자열/불리언).
export default function ConferenceFilterBar({ options, filters, onChange, onClear, hasActive, extras }) {
  const ms = (key, label, renderLabel) => (
    <FilterMultiSelect
      label={label}
      options={options[key] ?? []}
      selected={filters[key] ?? []}
      onChange={(v) => onChange(key, v)}
      renderLabel={renderLabel}
    />
  )

  return (
    <div className="flex items-center gap-2 flex-wrap">
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
  )
}
