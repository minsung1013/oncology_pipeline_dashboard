import { normalizeAffiliation } from '../../utils/dataClean'

export default function AuthorCell({ raw, name: parsedName, onClick }) {
  if (!raw && !parsedName) return <span className="text-slate-300">—</span>

  const clean = (raw ?? '').replace(/^First Author:\s*/i, '').trim()
  const commaIdx = clean.indexOf(',')
  // 우선 파싱된 author name 사용, 없으면 raw에서 첫 콤마 앞부분
  const name = parsedName || (commaIdx > -1 ? clean.slice(0, commaIdx).trim() : clean)
  const affil = commaIdx > -1 ? clean.slice(commaIdx + 1).trim() : ''

  return (
    <div>
      {onClick && name ? (
        <button
          onClick={() => onClick(name)}
          title={`Filter by ${name}`}
          className="font-medium text-blue-600 hover:underline text-xs leading-tight text-left"
        >
          {name}
        </button>
      ) : (
        <div className="font-medium text-slate-700 text-xs leading-tight">{name}</div>
      )}
      {affil && (
        <div className="text-xs text-slate-400 truncate max-w-44 leading-tight" title={affil}>
          {normalizeAffiliation(affil)}
        </div>
      )}
    </div>
  )
}
