import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
import ChartCard, { EmptyHint } from './ChartCard'

const COLORS = [
  '#3b82f6', '#a855f7', '#10b981', '#f43f5e', '#f59e0b',
  '#06b6d4', '#8b5cf6', '#ec4899', '#84cc16', '#6366f1',
]

// data: [{year, [key]: count, ...}], keys: [key, ...]
export default function TrendLineChart({ title, subtitle, data, keys, height = 360, action }) {
  const empty = !data || data.length === 0 || !keys || keys.length === 0
  return (
    <ChartCard title={title} subtitle={subtitle} height={height} action={action}>
      {empty ? (
        <EmptyHint message="No data for the current filter." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip formatter={(v) => v.toLocaleString()} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {keys.map((k, i) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
