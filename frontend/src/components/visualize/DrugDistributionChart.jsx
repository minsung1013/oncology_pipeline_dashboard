import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import ChartCard, { EmptyHint } from './ChartCard'

// 약물별 trial 수 (Top N). 회사 차트(①)와 같은 필터·클릭 패턴.
export default function DrugDistributionChart({ data, onSelect, selected = [] }) {
  const handleClick = (entry) => {
    if (entry && !entry.isOther && onSelect) onSelect(entry.name)
  }
  return (
    <ChartCard title="② Drug Distribution" subtitle="Trials per drug (Top N) — click a bar to filter" height={320}>
      {data.length === 0 ? (
        <EmptyHint message="No data." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
            <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10 }} interval={0} />
            <Tooltip formatter={(v) => v.toLocaleString()} />
            <Bar dataKey="count" radius={[0, 3, 3, 0]} onClick={handleClick} cursor="pointer">
              {data.map((d, i) => (
                <Cell key={i} fill={d.isOther ? '#cbd5e1' : selected.includes(d.name) ? '#0e7490' : '#0891b2'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
