import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import ChartCard, { EmptyHint } from './ChartCard'

export default function CompanyDistributionChart({ data, onSelect, selected = [] }) {
  const handleClick = (entry) => {
    if (entry && !entry.isOther && onSelect) onSelect(entry.name)
  }
  return (
    <ChartCard title="① Company Distribution" subtitle="Trials per pharma (normalized) — click a bar to filter" height={320}>
      {data.length === 0 ? (
        <EmptyHint message="No data." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="name"
              width={150}
              tick={{ fontSize: 11 }}
              interval={0}
            />
            <Tooltip formatter={(v) => v.toLocaleString()} />
            <Bar dataKey="count" radius={[0, 3, 3, 0]} onClick={handleClick} cursor="pointer">
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.isOther ? '#cbd5e1' : selected.includes(d.name) ? '#1d4ed8' : '#3b82f6'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
