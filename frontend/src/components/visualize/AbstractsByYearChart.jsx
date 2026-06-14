import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import ChartCard, { EmptyHint } from './ChartCard'

const CONF_COLORS = { ASCO: '#3b82f6', AACR: '#a855f7' }

// data: [{year, ASCO, AACR}], confs: ['ASCO','AACR']
export default function AbstractsByYearChart({ data, confs, filtered, loading }) {
  const subtitle = loading
    ? 'Loading abstracts…'
    : filtered
      ? 'ASCO + AACR matching the current filter'
      : 'ASCO + AACR — total per year (apply a filter to narrow)'
  const total = (data ?? []).reduce(
    (s, r) => s + (confs ?? []).reduce((t, c) => t + (r[c] ?? 0), 0), 0,
  )

  return (
    <ChartCard
      title="⑧ Conference Abstracts by Year"
      subtitle={`${subtitle}${data ? ` · ${total.toLocaleString()} abstracts` : ''}`}
      height={320}
    >
      {!data ? (
        <EmptyHint message="Loading…" />
      ) : data.length === 0 ? (
        <EmptyHint message="No abstracts match the current filter." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip formatter={(v) => v.toLocaleString()} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {(confs ?? []).map((c, i) => (
              <Bar key={c} dataKey={c} name={c} stackId="conf"
                   fill={CONF_COLORS[c] ?? '#94a3b8'}
                   radius={i === (confs.length - 1) ? [3, 3, 0, 0] : 0} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
