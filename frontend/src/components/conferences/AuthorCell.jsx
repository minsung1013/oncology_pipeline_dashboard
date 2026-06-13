export default function AuthorCell({ raw }) {
  if (!raw) return <span className="text-slate-300">—</span>

  const clean = raw.replace(/^First Author:\s*/i, '').trim()
  const commaIdx = clean.indexOf(',')
  const name = commaIdx > -1 ? clean.slice(0, commaIdx).trim() : clean
  const affil = commaIdx > -1 ? clean.slice(commaIdx + 1).trim() : ''

  return (
    <div>
      <div className="font-medium text-slate-700 text-xs leading-tight">{name}</div>
      {affil && (
        <div className="text-xs text-slate-400 truncate max-w-44 leading-tight" title={affil}>
          {affil}
        </div>
      )}
    </div>
  )
}
