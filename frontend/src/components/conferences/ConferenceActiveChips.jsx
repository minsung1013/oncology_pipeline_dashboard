import { phaseLabel } from '../../utils/visualizeAggregations'

// 선택된 모든 conference 필터를 제거 가능한 칩으로 표시 (두 conference 페이지 공용).
// onChange(key, value): 해당 축의 새 전체값. 어떤 선택이든 ✕로 해제 가능.
const AXES = [
  ['conferences', 'Source'], ['years', 'Year'], ['cancers', 'Cancer'], ['phases', 'Phase'],
  ['modalities', 'Modality'], ['countries', 'Country'], ['companies', 'Company'],
  ['targets', 'Target'], ['biomarkers', 'Biomarker'], ['institutions', 'Institution'],
]

export default function ConferenceActiveChips({ filters, onChange }) {
  const chips = []
  for (const [key, label] of AXES) {
    for (const value of filters[key] ?? []) chips.push({ key, label, value, arr: true })
  }
  if (filters.affiliation) chips.push({ key: 'affiliation', label: 'Affiliation', value: filters.affiliation })
  if (filters.keyword) chips.push({ key: 'keyword', label: 'Search', value: filters.keyword })
  if (filters.authorName) chips.push({ key: 'authorName', label: 'Author', value: filters.authorName })
  if (chips.length === 0) return null

  const remove = (c) => onChange(c.key, c.arr ? (filters[c.key] ?? []).filter((v) => v !== c.value) : '')

  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-2">
      {chips.map((c) => (
        <button
          key={`${c.key}:${c.value}`}
          onClick={() => remove(c)}
          className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
          title="Remove filter"
        >
          <span className="text-blue-400">{c.label}:</span>
          {c.key === 'phases' ? phaseLabel(c.value) : c.value}
          <span className="text-blue-400">✕</span>
        </button>
      ))}
    </div>
  )
}
