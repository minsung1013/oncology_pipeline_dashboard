import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import ChartCard, { EmptyHint } from './ChartCard'

// ASCO 초록 발표 — 회사(정규 제약사)별. 임상 파이프라인 회사 차트(①)와 같은 필터·축을 공유.
export default function AbstractCompanyChart({ data, total, loading, onSelect, selected = [] }) {
  const handleClick = (entry) => {
    if (entry && !entry.isOther && onSelect) onSelect(entry.name)
  }
  const subtitle = loading
    ? 'Loading ASCO 2026 abstracts…'
    : `${(total ?? 0).toLocaleString()} matching abstracts — click a bar to filter`

  return (
    <ChartCard title="⑧ ASCO 2026 Abstracts by Company" subtitle={subtitle} height={320}>
      {loading ? (
        <EmptyHint message="Loading…" />
      ) : data.length === 0 ? (
        <EmptyHint message="No sponsored abstracts match the current filter." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
            <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} interval={0} />
            <Tooltip formatter={(v) => v.toLocaleString()} />
            <Bar dataKey="count" radius={[0, 3, 3, 0]} onClick={handleClick} cursor="pointer">
              {data.map((d, i) => (
                <Cell key={i} fill={d.isOther ? '#cbd5e1' : selected.includes(d.name) ? '#7c3aed' : '#a855f7'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
