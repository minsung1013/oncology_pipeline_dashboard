import { normalizeAffiliation } from '../../utils/dataClean'

export default function AuthorCell({ raw, name: parsedName, onClick, count }) {
  if (!raw && !parsedName) return <span className="text-slate-300">—</span>

  const clean = (raw ?? '').replace(/^First Author:\s*/i, '').trim()
  const commaIdx = clean.indexOf(',')
  // 우선 파싱된 author name 사용, 없으면 raw에서 첫 콤마 앞부분
  const name = parsedName || (commaIdx > -1 ? clean.slice(0, commaIdx).trim() : clean)
  const affil = commaIdx > -1 ? clean.slice(commaIdx + 1).trim() : ''
  // 이 저자가 (현재 데이터에서) 교신저자로 등장한 기록 수
  const badge = count > 1 ? (
    <span
      title={`${count} records by this corresponding author (current view)`}
      className="ml-1 inline-flex items-center rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold px-1.5 leading-4 align-middle"
    >
      {count}
    </span>
  ) : null

  return (
    <div>
      {onClick && name ? (
        <button
          onClick={() => onClick(name)}
          title={`Filter by ${name}`}
          className="font-medium text-blue-600 hover:underline text-xs leading-tight text-left"
        >
          {name}{badge}
        </button>
      ) : (
        <div className="font-medium text-slate-700 text-xs leading-tight">{name}{badge}</div>
      )}
      {affil && (
        <div className="text-xs text-slate-400 truncate max-w-44 leading-tight" title={affil}>
          {normalizeAffiliation(affil)}
        </div>
      )}
    </div>
  )
}
