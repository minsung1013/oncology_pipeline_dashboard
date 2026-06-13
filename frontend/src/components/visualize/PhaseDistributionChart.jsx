import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import ChartCard, { EmptyHint } from './ChartCard'

export default function PhaseDistributionChart({ data, onSelect, selected = [] }) {
  const handleClick = (entry) => {
    if (entry && entry.raw && onSelect) onSelect(entry.raw)
  }
  return (
    <ChartCard title="② Phase Distribution" subtitle="By trial phase — click a bar to filter" height={320}>
      {data.length === 0 ? (
        <EmptyHint message="No data." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => v.toLocaleString()} />
            <Bar dataKey="count" radius={[3, 3, 0, 0]} onClick={handleClick} cursor="pointer">
              {data.map((d, i) => (
                <Cell key={i} fill={selected.includes(d.raw) ? '#4338ca' : '#6366f1'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
