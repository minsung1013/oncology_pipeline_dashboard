import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import ChartCard, { EmptyHint } from './ChartCard'
import { STATUS_META } from './statusMeta'

// counts: Map<statusKey, count> → STATUS_META 순서로 정렬된 표시 데이터
function toData(counts) {
  return STATUS_META
    .map((s) => ({ key: s.key, name: s.label, color: s.color, count: counts.get(s.key) ?? 0 }))
    .filter((d) => d.count > 0)
}

export default function StatusDistributionChart({ counts, onSelect, selected = [] }) {
  const data = toData(counts)
  const handleClick = (entry) => {
    const key = entry?.key ?? entry?.payload?.key
    if (key && onSelect) onSelect(key)
  }

  return (
    <ChartCard title="⑦ Status Distribution" subtitle="Trials per overall status — click a bar to filter" height={320}>
      {data.length === 0 ? (
        <EmptyHint message="No data." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} interval={0} />
            <Tooltip formatter={(v) => v.toLocaleString()} />
            <Bar dataKey="count" radius={[0, 3, 3, 0]} onClick={handleClick} cursor="pointer">
              {data.map((d) => (
                <Cell
                  key={d.key}
                  fill={d.color}
                  stroke={selected.includes(d.key) ? '#0f172a' : 'none'}
                  strokeWidth={selected.includes(d.key) ? 2 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
