import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import ChartCard, { EmptyHint } from './ChartCard'

// 학회별 색
const CONF_COLORS = { ASCO: '#3b82f6', AACR: '#a855f7' }

// manifest([{conference, year, count}]) → [{year, ASCO, AACR, ...}]
function toYearData(manifest) {
  const byYear = new Map()
  for (const m of manifest) {
    if (!byYear.has(m.year)) byYear.set(m.year, { year: m.year })
    byYear.get(m.year)[m.conference] = m.count
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year)
}

export default function AbstractsByYearChart({ manifest }) {
  if (!manifest) {
    return (
      <ChartCard title="⑧ Conference Abstracts by Year" subtitle="ASCO + AACR" height={320}>
        <EmptyHint message="Loading…" />
      </ChartCard>
    )
  }
  const data = toYearData(manifest)
  const confs = [...new Set(manifest.map((m) => m.conference))].sort()
  const total = manifest.reduce((s, m) => s + m.count, 0)

  return (
    <ChartCard
      title="⑧ Conference Abstracts by Year"
      subtitle={`ASCO + AACR · ${total.toLocaleString()} abstracts across ${data.length} years`}
      height={320}
    >
      {data.length === 0 ? (
        <EmptyHint message="No data." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => v.toLocaleString()} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {confs.map((c) => (
              <Bar key={c} dataKey={c} name={c} stackId="conf"
                   fill={CONF_COLORS[c] ?? '#94a3b8'} radius={c === confs[confs.length - 1] ? [3, 3, 0, 0] : 0} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
