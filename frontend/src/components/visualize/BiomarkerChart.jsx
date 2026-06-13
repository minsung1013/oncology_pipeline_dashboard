import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import ChartCard, { EmptyHint } from './ChartCard'

const COLORS = ['#f43f5e', '#e2e8f0']

export default function BiomarkerChart({ data, onSelect, selected = [] }) {
  const { mentioned, notMentioned, topBiomarkers } = data
  const total = mentioned + notMentioned
  const pieData = [
    { name: 'Mentioned', value: mentioned },
    { name: 'Not mentioned', value: notMentioned },
  ]
  const pct = total ? Math.round((mentioned / total) * 100) : 0

  return (
    <ChartCard title="⑥ Biomarker Mention" subtitle="Share of trials mentioning a biomarker" height={320}>
      {total === 0 ? (
        <EmptyHint message="No data." />
      ) : (
        <div className="h-full flex items-center gap-4">
          <div className="relative w-1/2 h-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  startAngle={90}
                  endAngle={-270}
                >
                  {pieData.map((d, i) => (
                    <Cell key={i} fill={COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => v.toLocaleString()} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold text-rose-600">{pct}%</span>
              <span className="text-xs text-slate-400">mentioned</span>
            </div>
          </div>

          <div className="w-1/2">
            <p className="text-xs font-semibold text-slate-500 mb-2">Top biomarkers — click to filter</p>
            {topBiomarkers.length === 0 ? (
              <p className="text-xs text-slate-400">None detected.</p>
            ) : (
              <ul className="space-y-1.5">
                {topBiomarkers.map((b) => {
                  const w = topBiomarkers[0].count ? (b.count / topBiomarkers[0].count) * 100 : 0
                  const sel = selected.includes(b.name)
                  return (
                    <li key={b.name}>
                      <button
                        onClick={() => onSelect && onSelect(b.name)}
                        className="w-full text-left text-xs group"
                      >
                        <div className="flex justify-between mb-0.5">
                          <span className={`font-medium ${sel ? 'text-rose-600' : 'text-slate-600 group-hover:text-rose-600'}`}>
                            {b.name}
                          </span>
                          <span className="text-slate-400">{b.count.toLocaleString()}</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${sel ? 'bg-rose-600' : 'bg-rose-400'}`}
                            style={{ width: `${w}%` }}
                          />
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </ChartCard>
  )
}
